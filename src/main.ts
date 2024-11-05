import "./style.css"

import type {
  Framegraph,
  FramegraphPass,
  GPUState,
  LegitScriptFrameResult,
  LegitScriptContextInput,
  LegitScriptShaderDesc,
  LegitScriptLoadResult,
  RaisesErrorFN,
  LegitScriptDeclaration,
} from "./types"

// @ts-ignore
import LegitScriptCompiler from "./LegitScript/LegitScriptWasm.js"
import type {
  ImageCache,
  ImageCacheAllocatedImage
} from "./image-cache.js"
import {
  ImageCacheGetImage
} from "./image-cache.js"

import type {
  FailedCompilationResult
} from "./webgl-shader-compiler.js"
import {
  CreateRasterProgram
} from "./webgl-shader-compiler.js"

import { SourceAssembler } from "./source-assembler.js"
import { demoContent } from "./initial-content.js"
import { ProcessScriptRequests, RunScriptInvocations, SetBlendMode } from "./legit-script-io.js"
import { UIState } from "./immediate-ui.js"

export type State = {
  // editor: any
  gpu: GPUState
  framegraph: Framegraph
  legitScriptCompiler: any
  uiState : UIState
  processedRequests : LegitScriptContextInput[]
  imageCache: ImageCache
  hasCompiledOnce: boolean
}

export function CompileLegitScript(
  legitScriptCompiler: LegitScriptCompiler,
): LegitScriptLoadResult | false {
  try {
    let foo =  (demoContent);
    const content = foo
    const r = JSON.parse(
      legitScriptCompiler.LegitScriptLoad(content)
    )
    return r
  } catch (e) {
    console.error(e)
    return false
  }
}

function LegitScriptFrame(
  legitScriptCompiler: LegitScriptCompiler,
  processedRequests : LegitScriptContextInput[]
): LegitScriptFrameResult | false {
  try {
    const raw = legitScriptCompiler.LegitScriptFrame(JSON.stringify(processedRequests))
    return JSON.parse(raw)
  } catch (e) {
    console.error(e)
    return false
  }
}

function createDebouncer(delay: number, fn: () => void) {
  let handle = setTimeout(fn, delay)
  return function () {
    handle && clearTimeout(handle)
    handle = setTimeout(fn, delay)
  }
}

function CreateFullscreenRenderer(gl: WebGL2RenderingContext) {
  const vertexBuffer = new Float32Array([-1, -1, -1, 4, 4, -1])
  const vao = gl.createVertexArray()

  gl.bindVertexArray(vao)
  var buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)
  gl.bindVertexArray(null)
  return function RenderFullscreenTriangle() {
    gl.disable(gl.DEPTH_TEST)
    gl.bindVertexArray(vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}



function InitWebGL(
  canvas: HTMLCanvasElement,
  raiseError: RaisesErrorFN
): GPUState {
  const options = {
    premultipliedAlpha: true,
    alpha: true,
    antialias: true,
  }

  Object.assign(canvas.style, {
    left: 0,
    top: 0,
    margin: 0,
    padding: 0,
    "pointer-events": "none",
    position: "absolute",
  })

  const gl = canvas.getContext("webgl2", options) as WebGL2RenderingContext

  const extensions = ["EXT_color_buffer_float", "EXT_color_buffer_half_float"]
  for (const extensionName of extensions) {
    const extension = gl.getExtension(extensionName)
    if (!extension) {
      raiseError(`${extensionName} could not be loaded`)
    }
  }

  const container = canvas.parentElement

  if (!container) {
    throw new Error("canvas must have a container")
  }
  
  const res = CreateRasterProgram(gl,
    `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D tex;
    out vec4 out_color;
    void main()
    {
      //out_color = vec4(texelFetch(tex, ivec2(gl_FragCoord.xy), 0).rgb, 1.0);
      out_color = vec4(pow(clamp(texelFetch(tex, ivec2(gl_FragCoord.xy), 0).rgb, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
    }`);

  return {
    container,
    copyProgram : res.type === 'success' ? res.program : null,
    canvas,
    dims: [0, 0],
    gl: gl,
    fullScreenRenderer: CreateFullscreenRenderer(gl),
  }
}

function AssembleShader(declarations: LegitScriptDeclaration[], shaderDesc : LegitScriptShaderDesc) : SourceAssembler
{
  const outputs = shaderDesc.outs.map(
    ({ name, type }, index) =>
      `layout(location=${index}) out ${type} ${name};\n`
  )
  const uniforms = shaderDesc.uniforms.map(
    ({ name, type }) => `uniform ${type} ${name};\n`
  )
  const samplers = shaderDesc.samplers.map(
    ({ name, type }) => `uniform ${type} ${name};`
  )

  var source_assembler = new SourceAssembler()
  source_assembler.addNonSourceBlock(
    `#version 300 es
    precision highp float;
    precision highp sampler2D;`)
  
  for(const include of shaderDesc.includes){
    for(const decl of declarations){
      if(decl.name == include){
        source_assembler.addSourceBlock(decl.body.text, decl.body.start);
        break
      }
    }
  }

  source_assembler.addNonSourceBlock(
    `${outputs.join("\n")}
    ${uniforms.join("\n")}
    ${samplers.join("\n")}`
  );
  source_assembler.addNonSourceBlock(`void main(){\n`)
  source_assembler.addSourceBlock(`${shaderDesc.body.text}`, shaderDesc.body.start);  
  source_assembler.addNonSourceBlock(`}\n`)
  return source_assembler
}

function CreatePass(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  fragSource : string,
  desc: LegitScriptShaderDesc
) : FramegraphPass{
  
  return{
    fragSource : fragSource,
    blendMode : desc.blend_mode,
    program : program,
    fbo : gl.createFramebuffer(),
    uniforms: desc.uniforms.map(({ name }) => {
      return gl.getUniformLocation(program, name)
    }),
    samplers: desc.samplers.map(({ name }) => {
      return gl.getUniformLocation(program, name)
    }),
    fboAttachmentIds: desc.outs.map((_, i) => gl.COLOR_ATTACHMENT0 + i),
  }
}

function UpdateFramegraph(
  { gl }: GPUState,
  framegraph: Framegraph,
  result: LegitScriptLoadResult | undefined,
) : FailedCompilationResult | null {
  if (!result) {
    return null
  }

  for (const desc of result.shader_descs || []) {

    const sourceAssembler = AssembleShader(result.declarations, desc)
    const fragSource = sourceAssembler.getResultText()
    let pass: FramegraphPass = framegraph.passes[desc.name]
    if (pass) {
      if (pass.fragSource === fragSource) {
        continue
      }
    }

    const res = CreateRasterProgram(gl, fragSource)
    if (res.type === 'fail') {
      const src_line = sourceAssembler.getSourceLine(res.line);
      return {
        line : src_line ? src_line : 0,
        msg : res.msg,
        type: 'fail'
      }
    }
    if(res.type === 'success')
    {
      if (pass?.program) {
        gl.deleteProgram(pass.program)
      }

      framegraph.passes[desc.name] = CreatePass(gl, res.program, fragSource, desc);
    }
  }
  return null
}

export async function OnEditorUpdate(
  state : State
  // decorations : monaco.editor.IEditorDecorationsCollection
  ){
  console.warn('EDITOR UPDATE');
  const compileResult = await CompileLegitScript(
    state.legitScriptCompiler
    // state.editor
  )
  if (compileResult) {
    if (compileResult.error) {
      console.error("ERR", compileResult)
      // const { line, column, desc } = compileResult.error
      // SetEditorSquiggies(decorations, state.editor, line, column, desc);
    } else {
      console.log("NOTERR", compileResult)
      // const model = state.editor.getModel()
      // if (model) {
        // monaco.editor.setModelMarkers(model, "legitscript", [])
        // decorations.set([])
      // }
      const err = UpdateFramegraph(state.gpu, state.framegraph, compileResult)
      if(err)
      {
        // SetEditorSquiggies(decorations, state.editor, err.line, 0, err.msg);
      } else
      {
        state.hasCompiledOnce = true
        // UnsetEditorSquiggies(decorations, state.editor);
      }
    }
  }
}

export async function Init(
  canvasEl: HTMLElement | null,
  controlsEl: HTMLElement | null,
) {
  // if (!editorEl || !canvasEl || !controlsEl || !draggerEl) {
  if (!canvasEl || !controlsEl ) {
    throw new Error("please provide an editor element and canvas element")
  }

  const legitScriptCompiler = await LegitScriptCompiler()



  const state: State = {
    // editor,
    gpu: InitWebGL(canvasEl as HTMLCanvasElement, console.error),
    framegraph: {
      passes: {},
    },
    legitScriptCompiler,
    processedRequests: [],
    uiState : new UIState(controlsEl),
    imageCache: {
      id: 0,
      allocatedImages: new Map<string, ImageCacheAllocatedImage>(),
      requestIdToAllocatedImage: new Map<number, ImageCacheAllocatedImage>(),
    },
    hasCompiledOnce: false,
  }

  // const decorations = editor.createDecorationsCollection([])
  const typingDebouncer = createDebouncer(100, () => {
    // OnEditorUpdate(state, decorations);
    OnEditorUpdate(state);
  })

  var i = 1;                  //  set your counter to 1

  function myLoop() {         //  create a loop function
    setTimeout(function() {   //  call a 3s setTimeout when the loop is called
      typingDebouncer();   //  your code here
      i++;                    //  increment the counter
      if (i < 10) {           //  if the counter < 10, call the loop function
        myLoop();             //  ..  again which will trigger another 
      }                       //  ..  setTimeout()
    }, 3000)
  }


  myLoop();   
  // editor.getModel()?.onDidChangeContent(typingDebouncer)
  requestAnimationFrame((dt) => ExecuteFrame(dt, state))
}

//there's no way in gles 3.0 to attach the backbuffer as part of an fbo. so we have to crate a temporary texture instead of the back buffer
//and at the end of the frame copy it onto the back buffer
function CopyTexToSwapchain(gpu: GPUState, tex : WebGLTexture | null){
  const gl = gpu.gl
  SetBlendMode(gl, 'opaque');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gpu.canvas.width, gpu.canvas.height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.useProgram(gpu.copyProgram)
  gpu.fullScreenRenderer()
}



function ExecuteFrame(dt: number, state: State) {
  if (!state.hasCompiledOnce) {
    // TODO: render a placeholder image "sorry, the shader didn't compile" or something
    requestAnimationFrame((dt) => ExecuteFrame(dt, state))
    return
  }
  
  const gpu = state.gpu

  // Ensure we're sized properly w.r.t. pixel ratio
  const rect = gpu.container.getBoundingClientRect()
  if (gpu.dims[0] !== rect.width || gpu.dims[1] !== rect.height) {
    gpu.dims[0] = rect.width
    gpu.dims[1] = rect.height

    //high DPI multiplier causes texture to fail to create when size is > 2048
    //const width = Math.floor(rect.width * window.devicePixelRatio)
    //const height = Math.floor(rect.height * window.devicePixelRatio)
    const width = rect.width
    const height = rect.height

    gpu.canvas.width = width
    gpu.canvas.height = height

    gpu.canvas.style.width = `${rect.width}px`
    gpu.canvas.style.height = `${rect.height}px`
  }

  const gl = gpu.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, gpu.canvas.width, gpu.canvas.height)
  gl.clearColor(0.0, 0.0, 0.0, 1.0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  if (!state.framegraph) {
    return
  }
  state.uiState.filterControls();

  state.processedRequests.push({
    name : '@swapchain_size',
    type : 'uvec2',
    value : {x : gpu.canvas.width, y: gpu.canvas.height}
  });
  state.processedRequests.push({
    name : '@time',
    type : 'float',
    value : dt
  });
  
  
  const legitFrame = LegitScriptFrame(
    state.legitScriptCompiler,
    state.processedRequests
  )
  state.processedRequests = []

  if (legitFrame) {
    try {
      state.processedRequests = ProcessScriptRequests(state.uiState, state.imageCache, {x: gpu.canvas.width, y: gpu.canvas.height}, gl, legitFrame.context_requests);
      RunScriptInvocations(state.imageCache, state.gpu, state.framegraph.passes, legitFrame.shader_invocations)
      CopyTexToSwapchain(gpu, ImageCacheGetImage(state.imageCache, 0));
    } catch (e) {
      // can console.log/console.error this, but it'll stuck in a busy loop until error resolves
    }
  }

  requestAnimationFrame((dt) => ExecuteFrame(dt, state))
}

Init(
    document.querySelector("output canvas"),
    document.querySelector("controls")
  );