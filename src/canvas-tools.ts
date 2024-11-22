// NOTE: preserveDrawingBuffer must be set true, or this needs to be called from render loop

export const webGLCanvasToPng = (webglCanvas: HTMLCanvasElement, width: number, height: number): string => {
    // Create an off-screen canvas to capture the WebGL canvas
    const offScreenCanvas: HTMLCanvasElement = document.createElement('canvas');
    const ctxTarget = offScreenCanvas.getContext('2d');

    if (!ctxTarget) {
        throw new Error('Failed to get 2D context from the off-screen canvas.');
    }

    // Set the off-screen canvas to the desired resolution
    offScreenCanvas.width = width;
    offScreenCanvas.height = height;

    // Draw the WebGL canvas content onto the off-screen canvas
    ctxTarget.drawImage(webglCanvas, 0, 0, width, height);

    // Convert the off-screen canvas to a PNG data URL
    return offScreenCanvas.toDataURL('image/png');
};


export const downloadWebGLCanvasAsPng = (webglCanvas:HTMLCanvasElement, width:number, height:number, fileName:string) => {
    const dataURL = webGLCanvasToPng(webglCanvas, width, height)
    
    // Create a link element to download the PNG
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = fileName || 'webgl-screenshot.png';
    
    // Simulate a click to trigger the download
    link.click();
};