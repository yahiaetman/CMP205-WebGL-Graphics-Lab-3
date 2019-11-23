import { Scene } from '../common/game';
import ShaderProgram from '../common/shader-program';
import Mesh from '../common/mesh';
import Camera from '../common/camera';
import FlyCameraController from '../common/camera-controllers/fly-camera-controller';
import { vec3, mat4 } from 'gl-matrix';
import { Vector, Selector } from '../common/dom-utils';
import { createElement, StatelessProps, StatelessComponent } from 'tsx-create-element';

// In this scene we will draw one rectangle with a texture
export default class TextureScene extends Scene {
    program: ShaderProgram;
    mesh: Mesh;
    camera: Camera;
    controller: FlyCameraController;
    textures: WebGLTexture[] = [];
    current_texture: number = 0;
    sampler: WebGLSampler;

    // These will be the texture coordinates for the 4 vertices of the rectangle, ordered: bottom left, bottom right, top right, top left
    // Note that texture coordinates span from 0 to 1, no matter how big or small the texture is
    // 0,0 is the bottom left of the image and 1,1 is the top right of the image
    texcoordinates: Float32Array = new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
    ]);
    wrap_s: number; // This will contain the wrapping option for the texture on the S-Axis
    wrap_t: number; // This will contain the wrapping option for the texture on the T-Axis
    mag_filter: number; // This will contain the magnification filtering option
    min_filter: number; // This will contain the magnification filtering option

    public load(): void {
        // These shaders will render 3D objects with textures
        // And we will also get an image to render on the rectangle
        this.game.loader.load({
            ["texture.vert"]:{url:'shaders/texture.vert', type:'text'},
            ["texture.frag"]:{url:'shaders/texture.frag', type:'text'},
            ["texture"]:{url:'images/color-grid.png', type:'image'}
        });
    } 
    
    public start(): void {
        this.program = new ShaderProgram(this.gl);
        this.program.attach(this.game.loader.resources["texture.vert"], this.gl.VERTEX_SHADER);
        this.program.attach(this.game.loader.resources["texture.frag"], this.gl.FRAGMENT_SHADER);
        this.program.link();

        // Create a colored rectangle using our Mesh class and add a slot for texture coordinates
        this.mesh = new Mesh(this.gl, [
            { attributeLocation: 0, buffer: "positions", size: 3, type: this.gl.FLOAT, normalized: false, stride: 0, offset: 0 },
            { attributeLocation: 1, buffer: "colors", size: 4, type: this.gl.UNSIGNED_BYTE, normalized: true, stride: 0, offset: 0 },
            { attributeLocation: 2, buffer: "texcoords", size: 2, type: this.gl.FLOAT, normalized: false, stride: 0, offset: 0 },
        ]);
        this.mesh.setBufferData("positions", new Float32Array([
            -0.5, -0.5, 0.0,
            0.5, -0.5, 0.0,
            0.5,  0.5, 0.0,
            -0.5,  0.5, 0.0,
        ]), this.gl.STATIC_DRAW);
        this.mesh.setBufferData("colors", new Uint8Array([
            255, 225, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
        ]), this.gl.STATIC_DRAW);
        this.mesh.setElementsData(new Uint32Array([
            0, 1, 2,
            2, 3, 0
        ]), this.gl.STATIC_DRAW);

        // By default, WebGL expected the texture data to start from the bottom left
        // but the javascript image class returns the data starting from the top left
        // So we tell WebGL to flip the image on the Y-Axis while unpacking the data and storing it into the texture memory
        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);

        {
            this.textures[0] = this.gl.createTexture(); // First, we create a texture
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[0]); // Then we bind it. Since we will use it to store a 2D image, we bind it to TEXTURE_2D
            const image: ImageData = this.game.loader.resources['texture']; // Here, We get the image data that we loaded from the server
            // Then we send the data to the texture
            // The parameters are:
            // target: which bound texture should be upload the data to
            // level: which mipmap level to upload the data to. Here we pick 0 since we will only upload the largest mip level then use generateMipmap to create the smaller mips
            // internalFormat: what format to use for storing data. Here we picked RGBA8 which means the we want 4 channels: R, G, B, A, and each channel will store 8 bits
            // format: the format of the data stored in the "image" parameter. Here the data we recieved contains 4 channels.
            // type: the data type of each channel in the "image" parameter. Here, it is unsigned byte.
            // source: the data to be uploaded
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA8, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image);
            // Since we uploaded the largest mip only and we need to generate the rest, we call generateMipmap
            this.gl.generateMipmap(this.gl.TEXTURE_2D);
        }

        {
            this.textures[1] = this.gl.createTexture(); // Once again, we create a texture
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[1]); // Then bind it
            const W = [255, 255, 255], Y = [255, 255, 0], B = [0, 0, 0];
            // Instead of reading an image from the server, we will write the data by hand into an array
            // The array here is packed in order: R0, G0, B0, R1, G1, B1, R2, G2, B2, ..... and so on
            // Since we enabled UNPACK_FLIP_Y_WEBGL, the first pixel in the array will go to the top left of the texture
            const data = new Uint8Array([
                ...W, ...W, ...W, ...Y, ...Y, ...Y, ...W, ...W, ...W,
                ...W, ...W, ...Y, ...Y, ...Y, ...Y, ...Y, ...W, ...W,
                ...W, ...Y, ...Y, ...Y, ...Y, ...Y, ...Y, ...Y, ...W,
                ...Y, ...Y, ...B, ...Y, ...Y, ...Y, ...B, ...Y, ...Y,
                ...Y, ...Y, ...B, ...Y, ...Y, ...Y, ...B, ...Y, ...Y,
                ...Y, ...Y, ...Y, ...Y, ...Y, ...Y, ...Y, ...Y, ...Y,
                ...W, ...Y, ...Y, ...B, ...B, ...B, ...Y, ...Y, ...W,
                ...W, ...W, ...Y, ...Y, ...Y, ...Y, ...Y, ...W, ...W,
                ...W, ...W, ...W, ...Y, ...Y, ...Y, ...W, ...W, ...W
            ]);
            // The default UNPACK_ALIGNMENT is 4. But this will not work here, since each row of the texture is not multiple of 4 bytes
            // So we change the alignment to 1 which is the only power of 2 that can divide 27 (9 pixels in a row * 3 channels per pixel * 1 byte per channel).
            // We can keep the UNPACK_ALIGNMENT as 1 for everything but it is bad for memory optimization on the GPU side. 
            this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
            // The texImage2D call here is slightly different
            // The parameters are:
            // target: which bound texture should be upload the data to
            // level: which mipmap level to upload the data to. Here we pick 0 since we will only upload the largest mip level then use generateMipmap to create the smaller mips
            // internalFormat: what format to use for storing data. Here we picked RGBA8 which means the we want 4 channels: R, G, B, A, and each channel will store 8 bits
            // ** width **: the width of the texture. We need this here since the function cannot infer the image size from the array size
            // ** height **: the height of the texture. We need this here since the function cannot infer the image size from the array size
            // border: the border size of the texture and it must be 0.
            // format: the format of the data stored in the "image" parameter. Here the data we recieved contains 4 channels.
            // type: the data type of each channel in the "image" parameter. Here, it is unsigned byte.
            // source: the data to be uploaded
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB8, 9, 9, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, data);
            this.gl.generateMipmap(this.gl.TEXTURE_2D); // Once again we generate the mipmaps
        }

        {
            this.textures[2] = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[2]);
            const WIDTH = 256, HEIGHT = 256;
            // Here, we will create a grayscale texture so we only need 1 byte per pixel.
            const data = new Uint8Array(WIDTH*HEIGHT);
            for(let j = 0; j < HEIGHT; j++){
                for(let i = 0; i < WIDTH; i++){
                    data[i + j*WIDTH] = (i+j)/2;
                }
            }
            // 256 (256 pixels in a row * 1 channel per pixel * 1 byte per channel) is divisible by 4 so we return to the default for optimization
            this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
            // Note that we pick LUMINANCE for both the internalFormat and format since the image is grayscale
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE, WIDTH, HEIGHT, 0, this.gl.LUMINANCE, this.gl.UNSIGNED_BYTE, data);
            this.gl.generateMipmap(this.gl.TEXTURE_2D); // Once again we generate the mipmaps
        }

        {
            this.textures[3] = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[3]);
            const WIDTH = 256, HEIGHT = 256;
            // Also, texture can hold floating point data. For demonstration, we create a texture with one channel containing floating point data 
            const data = new Float32Array(WIDTH*HEIGHT);
            for(let j = 0; j < HEIGHT; j++){
                for(let i = 0; i < WIDTH; i++){
                    data[i + j*WIDTH] = (i+j)/512;
                }
            }
            // 1024 (256 pixels in a row * 1 channel per pixel * 4 byte per channel) is divisible by 4 so we return to the default for optimization
            this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
            // The internalFormat is R32F since we have only 1 channel per pixel and each channel contains a 32-bit floating point number
            // The format is RED (one channel per pixel) and the type is FLOAT (each channel has a float)
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.R32F, WIDTH, HEIGHT, 0, this.gl.RED, this.gl.FLOAT, data);
            // this.gl.generateMipmap(this.gl.TEXTURE_2D); // MipMaps not supported for This type of textures
        }

        // Theoritically, the texture only contains pixel data so it does not define how the data will be read
        // That is why we create a sample that will define how to sample (a.k.a read) colors from the texture
        // Note: we said "theoritically" since it is not what happens practically, the textures actually contains parameters simpilar to the sampler parameters but splitting the responsibilities is preferred.
        this.sampler = this.gl.createSampler();
        
        // We pick REPEAT as the default wrapping mode
        this.wrap_s = this.wrap_t = this.gl.REPEAT;
        // We pick nearest as the default filtering mode
        this.mag_filter = this.min_filter = this.gl.NEAREST;

        this.camera = new Camera();
        this.camera.type = 'perspective';
        this.camera.position = vec3.fromValues(0,0,3);
        this.camera.direction = vec3.fromValues(0,0,-1);
        this.camera.aspectRatio = this.gl.drawingBufferWidth/this.gl.drawingBufferHeight;
        
        this.controller = new FlyCameraController(this.camera, this.game.input);
        this.controller.movementSensitivity = 0.001;

        this.gl.enable(this.gl.CULL_FACE);
        this.gl.cullFace(this.gl.BACK);
        this.gl.frontFace(this.gl.CCW);

        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);

        this.gl.clearColor(0,0,0,1);

        this.setupControls();
    }
    
    public draw(deltaTime: number): void {
        this.controller.update(deltaTime);

        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        // Since the texture coordinate are changeable from the UI, we send the data every frame and choose STREAM_DRAW to notify the driver that we will change the data frequently (for optimization)
        this.mesh.setBufferData("texcoords", this.texcoordinates, this.gl.STREAM_DRAW);
        
        this.program.use();

        this.program.setUniformMatrix4fv("MVP", false, this.camera.ViewProjectionMatrix);
        this.program.setUniform4f("tint", [1, 1, 1, 1]);

        // First, we send the sampler parameters to the sampler
        // We send the wrapping mode. For each dimension (S and T), we have 3 options:
        // - gl.REPEAT: if the texture coordinate is outside the range [0,1], remove the non-fractional part of the coordinate. e.g. 1.1 will become 0.1 (1.1-1), 2.3 will become 0.3 (0.3-2) and -0.1 will become 0.9 (-0.1+1).
        // - gl.MIRRORED_REPEAT: same a REPEAT but the out of bound coordinates will be mirrored.
        // - gl.CLAMP_TO_EDGE: any value out side [0,1] will be clamped. So 1.1 and 2.3 (or any value >1) will become 1 and -0.1 and -3.1 (or any value <0) will become 0.
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_WRAP_S, this.wrap_s);
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_WRAP_T, this.wrap_t);
        // We then send the filtering mode for the magnification filter.
        // Magnification happens when we zoom in towards a texture such that each pixel in the image covers multiple pixels on the screen.
        // We have 2 options:
        // - gl.NEAREST: when the texture coordinate points between texture pixels, return the color of the nearest pixel.
        // - gl.LINEAR: when the texture coordinate points between texture pixels, return the linear interpolaion of the colors of the 4 pixels around it. 
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_MAG_FILTER, this.mag_filter);
        // We then send the filtering mode for the minification filter.
        // Minification happens when we zoom out from a texture such that each pixel on the screen covers multiple pixels in the image.
        // We have 6 options:
        // - gl.NEAREST & gl.LINEAR: Same as in magnification.
        // - gl.NEAREST_MIPMAP_NEAREST & gl.LINEAR_MIPMAP_NEAREST: Pick the nearest mip level according to how much the texture is scaled on the screen, then apply NEAREST or LINEAR on that mip level.
        // - gl.NEAREST_MIPMAP_LINEAR & gl.LINEAR_MIPMAP_LINEAR: Pick the two nearest mip level according to how much the texture is scaled on the screen, then apply NEAREST or LINEAR on those mip levels, then linearly interpolate the results.
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_MIN_FILTER, this.min_filter);

        // To send the texture to the shader, we need to bind it under a texture unit
        // So first, we activate the texture unit (here we choose unit 0). Note: We have 32 units to choose from (TEXTURE0 up to TEXTURE31) 
        this.gl.activeTexture(this.gl.TEXTURE0);
        // Then, we bind our texture. Now it is bound as a TEXTURE_2D under unit 0.
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.current_texture]);
        // Then we also bind our sampler to unit 0.
        this.gl.bindSampler(0, this.sampler);
        // Then we send 0 to the sampler uniform variable to notify it that it should read from unit 0.
        this.program.setUniform1i('texture_sampler', 0);
        
        // Now, we can draw... finally
        this.mesh.draw(this.gl.TRIANGLES);
    }
    
    public end(): void {
        this.program.dispose();
        this.program = null;
        this.mesh.dispose();
        this.mesh = null;
        for(let texture of this.textures)
            this.gl.deleteTexture(texture);
        this.textures = [];
        this.gl.deleteSampler(this.sampler);
        this.clearControls();
    }


    /////////////////////////////////////////////////////////
    ////// ADD CONTROL TO THE WEBPAGE (NOT IMPORTNANT) //////
    /////////////////////////////////////////////////////////
    private setupControls() {
        const controls = document.querySelector('#controls');
        
        const wrapOptions = {
            [this.gl.CLAMP_TO_EDGE]:"Clamp to Edge",
            [this.gl.REPEAT]:"Repeat",
            [this.gl.MIRRORED_REPEAT]:"Mirrored Repeat"
        };

        const magfilteringOptions = {
            [this.gl.NEAREST]:"Nearest",
            [this.gl.LINEAR]:"Linear"
        };

        const minfilteringOptions = {
            [this.gl.NEAREST]:"Nearest",
            [this.gl.LINEAR]:"Linear",
            [this.gl.NEAREST_MIPMAP_NEAREST]:"Nearest MipMap Nearest",
            [this.gl.NEAREST_MIPMAP_LINEAR]:"Nearest MipMap Linear",
            [this.gl.LINEAR_MIPMAP_NEAREST]:"Linear MipMap Nearest",
            [this.gl.LINEAR_MIPMAP_LINEAR]:"Linear MipMap Linear"
        };

        controls.appendChild(
            <div>
                <div className="control-row">
                    <label className="control-label">Texture</label>
                    <Selector options={Object.fromEntries(this.textures.map((_,i)=>[i.toString(),i.toString()]))} value={this.current_texture.toString()} onchange={(v) => {this.current_texture = Number.parseInt(v)}}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Top Left</label>
                    <Vector vector={this.texcoordinates} start={6} length={2}/>
                    <label className="control-label">Top Right</label>
                    <Vector vector={this.texcoordinates} start={4} length={2}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Bottom Left</label>
                    <Vector vector={this.texcoordinates} start={0} length={2}/>
                    <label className="control-label">Bottom Right</label>
                    <Vector vector={this.texcoordinates} start={2} length={2}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Wrap on S-Axis</label>
                    <Selector options={wrapOptions} value={this.wrap_s.toString()} onchange={(v) => {this.wrap_s = Number.parseInt(v)}}/>
                    <label className="control-label">Wrap on T-Axis</label>
                    <Selector options={wrapOptions} value={this.wrap_t.toString()} onchange={(v) => {this.wrap_t = Number.parseInt(v)}}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Magnification Filter</label>
                    <Selector options={magfilteringOptions} value={this.mag_filter.toString()} onchange={(v) => {this.mag_filter = Number.parseInt(v)}}/>
                    <label className="control-label">Minification Filter</label>
                    <Selector options={minfilteringOptions} value={this.min_filter.toString()} onchange={(v) => {this.min_filter = Number.parseInt(v)}}/>
                </div>
            </div>
            
        );
        
    }

    private clearControls() {
        const controls = document.querySelector('#controls');
        controls.innerHTML = "";
    }


}