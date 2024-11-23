import "./style.css"

declare global {
    interface Window { lslcore: any; }
}

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
import LegitScriptCompiler from "./legitsl/LegitScriptWasm";
import type { ImageCache, ImageCacheAllocatedImage } from "./image-cache";
import { ImageCacheGetImage } from "./image-cache.js";
import type { FailedCompilationResult } from "./webgl-shader-compiler";
import { CreateRasterProgram } from "./webgl-shader-compiler";

import { SourceAssembler } from "./source-assembler";

import { webGLCanvasToPng } from './canvas-tools';


// import { demoContent } from "./initial-content.js"
import { 
  ProcessScriptRequests, 
  RunScriptInvocations, 
  SetBlendMode,

  contextValues,
  contextDefsFloat,
  contextDefsInt,
  contextDefsBool,
  contextDefsText,
  activeContextVarNames,
} from "./legit-script-io.js";

class LegitSLError extends Error {
  info: any;

  constructor(message:string, info:any) {
    super(message); 
    this.name = 'LegitSLError'; 
    this.info = info; 
  }
}

export type State = {
  // editor: any
  gpu: GPUState;
  framegraph: Framegraph;
  legitScriptCompiler: any;
  processedRequests : LegitScriptContextInput[];
  imageCache: ImageCache;
  hasCompiledOnce: boolean;
};

let currentState: State;
let animationFrameId: number | null = null;
let canvasEl: HTMLCanvasElement | null;

export const compileLegitScript = (content: string, legitScriptCompiler: LegitScriptCompiler): LegitScriptLoadResult | false => {
  const r = JSON.parse(
    legitScriptCompiler.LegitScriptLoad(content)
  )
  return r;
};

const legitScriptFrame = (legitScriptCompiler: LegitScriptCompiler, processedRequests : LegitScriptContextInput[]): LegitScriptFrameResult | false => {
  const raw = legitScriptCompiler.LegitScriptFrame(JSON.stringify(processedRequests));
  return JSON.parse(raw);
};

const createFullscreenRenderer = (gl: WebGL2RenderingContext) => {
  const vertexBuffer = new Float32Array([-1, -1, -1, 4, 4, -1]);
  const vao = gl.createVertexArray();

  gl.bindVertexArray(vao);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, vertexBuffer, gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindVertexArray(null);
  return function RenderFullscreenTriangle() {
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
};

const initWebGL = (canvas: HTMLCanvasElement, raiseError: RaisesErrorFN): GPUState => {
  const options = {
    premultipliedAlpha: true,
    alpha: true,
    antialias: true,
  };

  Object.assign(canvas.style, {
    left: 0,
    top: 0,
    margin: 0,
    padding: 0,
    "pointer-events": "none",
    position: "absolute",
  });

  const gl = canvas.getContext("webgl2", options) as WebGL2RenderingContext;

  const extensions = ["EXT_color_buffer_float", "EXT_color_buffer_half_float"];
  for (const extensionName of extensions) {
    const extension = gl.getExtension(extensionName);
    if (!extension) {
      raiseError(`${extensionName} could not be loaded`);
    }
  }

  const container = canvas.parentElement;

  if (!container) {
    throw new Error("canvas must have a container");
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
    fullScreenRenderer: createFullscreenRenderer(gl),
  };
};

const assembleShader = (declarations: LegitScriptDeclaration[], shaderDesc : LegitScriptShaderDesc) : SourceAssembler =>
{
  const outputs = shaderDesc.outs.map(
    ({ name, type }, index) =>
      `layout(location=${index}) out ${type} ${name};\n`
  );
  const uniforms = shaderDesc.uniforms.map(
    ({ name, type }) => `uniform ${type} ${name};\n`
  );
  const samplers = shaderDesc.samplers.map(
    ({ name, type }) => `uniform ${type} ${name};`
  );

  var source_assembler = new SourceAssembler();
  source_assembler.addNonSourceBlock(
    `#version 300 es
    precision highp float;
    precision highp sampler2D;`);
  
  for (const include of shaderDesc.includes){
    for (const decl of declarations){
      if(decl.name == include){
        source_assembler.addSourceBlock(decl.body.text, decl.body.start);
        break;
      }
    }
  }

  source_assembler.addNonSourceBlock(
    `${outputs.join("\n")}
    ${uniforms.join("\n")}
    ${samplers.join("\n")}`
  );
  source_assembler.addNonSourceBlock(`void main(){\n`);
  source_assembler.addSourceBlock(`${shaderDesc.body.text}`, shaderDesc.body.start);
  source_assembler.addNonSourceBlock(`}\n`);
  return source_assembler;
};

const createPass = (gl: WebGL2RenderingContext, program: WebGLProgram, fragSource : string, desc: LegitScriptShaderDesc) : FramegraphPass => {
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
  };
};

const updateFramegraph = ({ gl }: GPUState, framegraph: Framegraph, result: LegitScriptLoadResult | undefined,) : FailedCompilationResult | null => {
  if (!result) {
    return null;
  }

  for (const desc of result.shader_descs || []) {
    const sourceAssembler = assembleShader(result.declarations, desc);
    const fragSource = sourceAssembler.getResultText();
    let pass: FramegraphPass = framegraph.passes[desc.name];
    if (pass) {
      if (pass.fragSource === fragSource) {
        continue;
      }
    }

    const res = CreateRasterProgram(gl, fragSource);
    if (res.type === 'fail') {
      const src_line = sourceAssembler.getSourceLine(res.line);
      return {
        line : src_line ? src_line : 0,
        msg : res.msg,
        type: 'fail'
      };
    }
    if (res.type === 'success') {
      if (pass?.program) {
        gl.deleteProgram(pass.program);
      }

      framegraph.passes[desc.name] = createPass(gl, res.program, fragSource, desc);
    }
  }
  return null;
};

export const onEditorUpdate = async (content: string) => {
  const compileResult = await compileLegitScript(
    content,
    currentState.legitScriptCompiler
    // state.editor
  )
  if (compileResult) {
    if (compileResult.error) {
      throw new LegitSLError(compileResult.error.desc, {
        line: compileResult.error.line,
        column: compileResult.error.column,
      });
    } else {
      const err = updateFramegraph(currentState.gpu, currentState.framegraph, compileResult)
      if(err) {
        throw new LegitSLError(err.msg, {
          line: err.line,
          column: 0,
        });
      } else {
        currentState.hasCompiledOnce = true;
        takeScreenshot();
        executeFrame();
        // UnsetEditorSquiggies(decorations, currentState.editor);
      }
    }
  }
};

export const init = async () => {
  if (!canvasEl) throw new Error("please provide a canvas element");
  const legitScriptCompiler = await LegitScriptCompiler();
  currentState = {
    // editor,
    gpu: initWebGL(canvasEl as HTMLCanvasElement, console.error),
    framegraph: {
      passes: {},
    },
    legitScriptCompiler,
    processedRequests: [],
    imageCache: {
      id: 0,
      allocatedImages: new Map<string, ImageCacheAllocatedImage>(),
      requestIdToAllocatedImage: new Map<number, ImageCacheAllocatedImage>(),
    },
    hasCompiledOnce: false,
  };
};

//there's no way in gles 3.0 to attach the backbuffer as part of an fbo. so we have to crate a temporary texture instead of the back buffer
//and at the end of the frame copy it onto the back buffer
const copyTexToSwapchain = (gpu: GPUState, tex : WebGLTexture | null) => {
  const gl = gpu.gl
  SetBlendMode(gl, 'opaque');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gpu.canvas.width, gpu.canvas.height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.useProgram(gpu.copyProgram)
  gpu.fullScreenRenderer()
};



const executeFrame = (dt: number = 0) => {
  if (!currentState.hasCompiledOnce) {
    // TODO: render a placeholder image "sorry, the shader didn't compile" or something
    // executeLoop(dt);
    return;
  }
  
  const gpu = currentState.gpu;

  // Ensure we're sized properly w.r.t. pixel ratio
  const rect = gpu.container.getBoundingClientRect();
  if (gpu.dims[0] !== rect.width || gpu.dims[1] !== rect.height) {
    gpu.dims[0] = rect.width;
    gpu.dims[1] = rect.height;

    //high DPI multiplier causes texture to fail to create when size is > 2048
    //const width = Math.floor(rect.width * window.devicePixelRatio)
    //const height = Math.floor(rect.height * window.devicePixelRatio)
    const width = rect.width || 1; // dim = 0 causes webgl warning spam
    const height = rect.height || 1;

    gpu.canvas.width = width;
    gpu.canvas.height = height;

    gpu.canvas.style.width = `${rect.width}px`;
    gpu.canvas.style.height = `${rect.height}px`;
  }

  const gl = gpu.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gpu.canvas.width, gpu.canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!currentState.framegraph) {
    return
  }
  // currentState.uiState.filterControls();

  currentState.processedRequests.push({
    name : '@swapchain_size',
    type : 'uvec2',
    value : {x : gpu.canvas.width, y: gpu.canvas.height}
  });
  currentState.processedRequests.push({
    name : '@time',
    type : 'float',
    value : dt
  });
  
  
  const legitFrame = legitScriptFrame(
    currentState.legitScriptCompiler,
    currentState.processedRequests
  );

  currentState.processedRequests = [];

  if (legitFrame) {
    try {
      currentState.processedRequests = ProcessScriptRequests(
        currentState.imageCache, 
        {
          x: gpu.canvas.width, 
          y: gpu.canvas.height
        }, 
        gl, 
        legitFrame.context_requests
      );
      RunScriptInvocations(currentState.imageCache, currentState.gpu, currentState.framegraph.passes, legitFrame.shader_invocations);
      copyTexToSwapchain(gpu, ImageCacheGetImage(currentState.imageCache, 0));
    } catch (e) {
      // can console.log/console.error this, but it'll stuck in a busy loop until error resolves
    }
  }
};

const takeScreenshot = () => {  
  if (canvasEl) {
    let lastWidth: number = canvasEl.width;
    let lastHeight: number = canvasEl.height;
    canvasEl.width = window.lslcore.screenshotWidth;
    canvasEl.height = window.lslcore.screenshotHeight;
    executeFrame(0);
    window.lslcore.screenshot = webGLCanvasToPng(canvasEl, window.lslcore.screenshotWidth, window.lslcore.screenshotHeight);
    canvasEl.width = lastWidth;
    canvasEl.height = lastHeight;
  };
};

const executeLoop = (dt: number = 0) => {
  executeFrame(dt);
  animationFrameId = requestAnimationFrame(executeLoop);
};

const cancelLoop = () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

const configure = (canvasSelector: string = "#output-container canvas") => {
  canvasEl = document.querySelector(canvasSelector);
  if (!canvasEl) {
      throw new Error(`Canvas element not found for selector: ${canvasSelector}`);
  }
};

window.lslcore = {
  configure:              configure,
  init:                   init,
  update:                 onEditorUpdate,
  executeLoop:            executeLoop,
  cancelLoop:             cancelLoop,
  contextValues:          contextValues,
  contextDefsFloat:       contextDefsFloat,
  contextDefsInt:         contextDefsInt,
  contextDefsBool:        contextDefsBool,
  contextDefsText:        contextDefsText,
  activeContextVarNames:  activeContextVarNames,
  screenshot:             null,
  screenshotWidth:        32,
  screenshotHeight:       32
};