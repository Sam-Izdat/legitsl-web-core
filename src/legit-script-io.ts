import type {
  uvec2,
  LegitScriptContextRequest,
  LegitScriptContextInput,
  GPUState,
  FramegraphPasses,
  LegitScriptShaderInvocation,
  LegitScriptBlendModes} from "./types";

import type {
  ImageCache
} from "./image-cache";

import {
  ImageCacheGetImage,
  ImageCacheGetSize,
  ImageCacheStartFrame,
  ImageCacheProcessRequest} from "./image-cache";

// import { UIState } from "./immediate-ui";

export let contextValues: Map<string, any> = new Map();

export let contextDefsFloat:        Set<string> = new Set();
export let contextDefsInt:          Set<string> = new Set();
export let contextDefsBool:         Set<string> = new Set();
export let contextDefsText:         Set<string> = new Set();

export let activeContextVarNames:   Set<string> = new Set();

export function ProcessScriptRequests(
  imageCache : ImageCache,
  swapchainSize : uvec2,
  gl : WebGL2RenderingContext,
  contextRequests : LegitScriptContextRequest[]) : LegitScriptContextInput[]
{
  var contextInputs : LegitScriptContextInput[] = [];

  contextDefsFloat.clear();
  contextDefsInt.clear();
  contextDefsBool.clear();
  contextDefsText.clear();

  activeContextVarNames.clear();

  ImageCacheStartFrame(
    gl,
    imageCache,
  )
  //This image will be copied into the swapchain
  ImageCacheProcessRequest(
    gl,
    imageCache,
    {id : 0, pixel_format : 'rgba16f', size : swapchainSize, type : 'CachedImageRequest'},
    console.error)

  let sortIdx = 0;
  for(const request of contextRequests){
    switch(request.type) {
      case 'CachedImageRequest':        
        ImageCacheProcessRequest(
          gl,
          imageCache,
          request,
          console.error
        );
        break;
      case 'TextRequest':
        contextDefsText.add(JSON.stringify({...request, sort_idx: sortIdx}));
        sortIdx++;
        break;
      case 'FloatRequest':
        contextInputs.push({
          name : request.name,
          type : 'float',
          value : contextValues.get(request.name) ?? request.def_val
          // uiState.floatSlider(request.name, request.def_val, request.min_val, request.max_val)
        });
        contextDefsFloat.add(JSON.stringify({...request, sort_idx: sortIdx}));
        activeContextVarNames.add(request.name);
        sortIdx++;
        break;
      case 'IntRequest':
        contextInputs.push({
          name : request.name,
          type : 'int',
          value : contextValues.get(request.name) ?? request.def_val
          // uiState.intSlider(request.name, request.def_val, request.min_val, request.max_val)
        });
        contextDefsInt.add(JSON.stringify({...request, sort_idx: sortIdx}));
        activeContextVarNames.add(request.name);
        sortIdx++;
        break;
      case 'BoolRequest':
        contextInputs.push({
          name : request.name,
          type : 'int',
          value : contextValues.get(request.name) ?? request.def_val
        });
        contextDefsBool.add(JSON.stringify({...request, sort_idx: sortIdx}));
        activeContextVarNames.add(request.name);
        sortIdx++;
        break;
      case 'LoadedImageRequest':
        // ---
        break;
    }
  }
  return contextInputs;
}

export function SetBlendMode(gl: WebGL2RenderingContext, blendMode : LegitScriptBlendModes)
{
  gl.enable(gl.BLEND);
  switch(blendMode) {
    case 'opaque': 
      gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
      gl.blendEquation(gl.FUNC_ADD);
      break;
    case 'alphablend': 
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      //gl.blendFunc(gl.ONE, gl.ONE);
      gl.blendEquation(gl.FUNC_ADD)
      break;
    case 'additive': 
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      gl.blendEquation(gl.FUNC_ADD)
      break;
    case 'multiplicative': 
      gl.blendFunc(gl.DST_COLOR, gl.ZERO)
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.DST_ALPHA, gl.ZERO);
      gl.blendEquation(gl.FUNC_ADD)
      break;
  }
}

export function RunScriptInvocations(
  imageCache: ImageCache,
  gpu: GPUState,
  passes: FramegraphPasses,
  shaderInvocations : LegitScriptShaderInvocation[])
{
  const gl = gpu.gl;
  for (const invocation of shaderInvocations) {
    const pass = passes[invocation.shader_name]
    gl.useProgram(pass.program)

    for (
      let uniformIndex = 0;
      uniformIndex < invocation.uniforms.length;
      uniformIndex++
    ) {
      const uniform = invocation.uniforms[uniformIndex]
      if (!uniform) {
        continue
      }

      switch (uniform.type) {
        case 'float':
          gl.uniform1f(pass.uniforms[uniformIndex], uniform.value)
          break;
        case 'vec2':
          gl.uniform2f(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y)
          break;
        case 'vec3':
          gl.uniform3f(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z)
          break;
        case 'vec4':
          gl.uniform4f(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z, uniform.value.w)
          break;
        case 'int':
          gl.uniform1i(pass.uniforms[uniformIndex], uniform.value)
          break;
        case 'ivec2':
          gl.uniform2i(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y)
          break;
        case 'ivec3':
          gl.uniform3i(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z)
          break;
        case 'ivec4':
          gl.uniform4i(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z, uniform.value.w)
          break;
        case 'uint':
          gl.uniform1ui(pass.uniforms[uniformIndex], uniform.value)
          break;
        case 'uvec2':
          gl.uniform2ui(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y)
          break;
        case 'uvec3':
          gl.uniform3ui(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z)
          break;
        case 'uvec4':
          gl.uniform4ui(pass.uniforms[uniformIndex], uniform.value.x, uniform.value.y, uniform.value.z, uniform.value.w)
          break;
      }
    }

    for (
      let samplerIndex = 0;
      samplerIndex < invocation.image_sampler_bindings.length;
      samplerIndex++
    ) {
      const sampler = invocation.image_sampler_bindings[samplerIndex]
      const handle = ImageCacheGetImage(imageCache, sampler.id)
      if (!handle) {
        console.error("missing image from image cache %s", sampler)
      }

      gl.activeTexture(gl.TEXTURE0 + samplerIndex)
      gl.bindTexture(gl.TEXTURE_2D, handle)
      gl.uniform1i(pass.samplers[samplerIndex], samplerIndex)
      gl.bindTexture(gl.TEXTURE_2D, handle)
    }

    // special case for swapchain image
    var viewportSize = {x: -1, y: -1};
    // TODO: bind more than one output
    gl.bindFramebuffer(gl.FRAMEBUFFER, pass.fbo)
    
    if (invocation.color_attachments.length != pass.fboAttachmentIds.length) {
      console.error("Mismatch in invocation vs pass description attachment count")
    }
    for (
      let attachmentIndex = 0;
      attachmentIndex < invocation.color_attachments.length;
      attachmentIndex++
    ) {
      const attachment = invocation.color_attachments[attachmentIndex]
      const target = ImageCacheGetImage(imageCache, attachment.id)
      const size = ImageCacheGetSize(imageCache, attachment.id);
      if(viewportSize.x > 0 && viewportSize.y > 0 && (viewportSize.x != size.x || viewportSize.y != size.y)){
        console.error("Attachments can't be of different size")
        return
      }
      viewportSize = size;
      
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        pass.fboAttachmentIds[attachmentIndex],
        gl.TEXTURE_2D,
        target,
        0
      )
    }
    // TODO: handle framebuffer completeness
    gl.drawBuffers(pass.fboAttachmentIds)

    gl.viewport(0, 0, viewportSize.x, viewportSize.y)
    SetBlendMode(gl, pass.blendMode)
    gpu.fullScreenRenderer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}