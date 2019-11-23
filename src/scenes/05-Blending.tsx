import { Scene } from '../common/game';
import ShaderProgram from '../common/shader-program';
import Mesh from '../common/mesh';
import * as MeshUtils from '../common/mesh-utils';
import Camera from '../common/camera';
import FlyCameraController from '../common/camera-controllers/fly-camera-controller';
import { vec3, mat4, quat, vec4 } from 'gl-matrix';
import { CheckBox, Color, Selector } from '../common/dom-utils';
import { createElement, StatelessProps, StatelessComponent } from 'tsx-create-element';

interface Renderer {
    scale: vec3,
    rotation: quat,
    position: vec3,
    texture: WebGLTexture,
    sampler: WebGLSampler,
    tint: vec4,
    mesh: Mesh,
    transparent: boolean
}

// In this scene we will draw a set of cubes with blending
export default class BlendingScene extends Scene {
    program: ShaderProgram;
    meshes: {[name: string]: Mesh} = {};
    camera: Camera;
    controller: FlyCameraController;
    textures: {[name: string]:WebGLTexture} = {};
    sampler: WebGLSampler;
    renderers: Renderer[];

    // This will contain all the blending options
    blendingEnabled: boolean;
    blendEquation: GLenum;
    srcFactor: GLenum;
    dstFactor: GLenum;
    constantColor: Float32Array;

    sortRenderers: boolean = false;
    backFaceCulling: boolean = true;
    depthTesting: boolean = true;
    alphaToCoverage: boolean = false;

    public load(): void {
        this.game.loader.load({
            ["texture.vert"]:{url:'shaders/texture.vert', type:'text'},
            ["texture.frag"]:{url:'shaders/texture.frag', type:'text'},
            ["color-grid"]:{url:'images/color-grid.png', type:'image'},
            ["metal"]:{url:'images/metal.png', type:'image'},
            ["glass"]:{url:'images/transparent1.png', type:'image'},
            ["fog"]:{url:'images/fog.png', type:'image'}
        });
    } 
    
    public start(): void {
        this.program = new ShaderProgram(this.gl);
        this.program.attach(this.game.loader.resources["texture.vert"], this.gl.VERTEX_SHADER);
        this.program.attach(this.game.loader.resources["texture.frag"], this.gl.FRAGMENT_SHADER);
        this.program.link();

        this.meshes['cube'] = MeshUtils.Cube(this.gl);
        this.meshes['plane'] = MeshUtils.Plane(this.gl, {min:[0,0], max:[20, 20]});

        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
        
        this.textures['color-grid'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['color-grid']);
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.game.loader.resources['color-grid']);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);

        this.textures['metal'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['metal']);
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.game.loader.resources['metal']);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);

        this.textures['glass'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['glass']);
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.game.loader.resources['glass']);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);

        this.textures['fog'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['fog']);
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.game.loader.resources['fog']);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        
        this.textures['white'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['white']);
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB, 1, 1, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));
        this.gl.generateMipmap(this.gl.TEXTURE_2D);

        this.textures['grid'] = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures['grid']);
        const C0 = [127, 127, 127], C1 = [255, 255, 255];
        const W = 1024, H = 1024, cW = 256, cH = 256;
        let data = Array(W*H*3);
        for(let j = 0; j < H; j++){
            for(let i = 0; i < W; i++){
                data[i + j*W] = (Math.floor(i/cW) + Math.floor(j/cH))%2 == 0 ? C0 : C1;
            }
        }
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGB, W, H, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, new Uint8Array(data.flat()));
        this.gl.generateMipmap(this.gl.TEXTURE_2D);

        this.sampler = this.gl.createSampler();
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.samplerParameteri(this.sampler, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);

        this.renderers = [
            {scale: vec3.fromValues(20,1,20), rotation: quat.create(), position: vec3.fromValues(0,0,0), texture: this.textures['grid'], sampler: this.sampler, tint: vec4.fromValues(1,0.9,0.7,1), mesh: this.meshes['plane'], transparent: false},
            {scale: vec3.fromValues(1,1,1), rotation: quat.create(), position: vec3.fromValues(0,1.01,0), texture: this.textures['fog'], sampler: this.sampler, tint: vec4.fromValues(1,1,1,1), mesh: this.meshes['cube'], transparent: true},
            {scale: vec3.fromValues(1,1,1), rotation: quat.create(), position: vec3.fromValues(3,1.01,0), texture: this.textures['metal'], sampler: this.sampler, tint: vec4.fromValues(1,1,1,1), mesh: this.meshes['cube'], transparent: true},
            {scale: vec3.fromValues(1,1,1), rotation: quat.create(), position: vec3.fromValues(-3,1.01,0), texture: this.textures['glass'], sampler: this.sampler, tint: vec4.fromValues(1,1,1,1), mesh: this.meshes['cube'], transparent: true},
            {scale: vec3.fromValues(1,1,1), rotation: quat.create(), position: vec3.fromValues(0,1.01,3), texture: this.textures['color-grid'], sampler: this.sampler, tint: vec4.fromValues(1,1,1,0.5), mesh: this.meshes['cube'], transparent: true},
            {scale: vec3.fromValues(1,1,1), rotation: quat.create(), position: vec3.fromValues(0,1.01,-3), texture: this.textures['white'], sampler: this.sampler, tint: vec4.fromValues(0,0,1,0.5), mesh: this.meshes['cube'], transparent: true},
        ]

        this.camera = new Camera();
        this.camera.type = 'perspective';
        this.camera.position = vec3.fromValues(3,3,3);
        this.camera.direction = vec3.fromValues(-1,-1,-1);
        this.camera.aspectRatio = this.gl.drawingBufferWidth/this.gl.drawingBufferHeight;
        
        this.controller = new FlyCameraController(this.camera, this.game.input);
        this.controller.movementSensitivity = 0.001;

        this.sortRenderers = false;
        this.backFaceCulling = true;
        this.depthTesting = true;
        this.alphaToCoverage = false;

        this.gl.enable(this.gl.CULL_FACE);
        this.gl.cullFace(this.gl.BACK);
        this.gl.frontFace(this.gl.CCW);

        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);

        this.gl.clearColor(0.98,0.9,0.8,1);

        this.blendingEnabled = true;
        this.blendEquation = this.gl.FUNC_ADD;
        this.srcFactor = this.gl.SRC_ALPHA;
        this.dstFactor = this.gl.ONE_MINUS_SRC_ALPHA;
        this.constantColor = new Float32Array([1,1,1,1]);

        this.setupControls();
    }
    
    public draw(deltaTime: number): void {
        this.controller.update(deltaTime);

        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        if(this.backFaceCulling){
            this.gl.enable(this.gl.CULL_FACE);
        } else {
            this.gl.disable(this.gl.CULL_FACE);
        }

        if(this.alphaToCoverage){
            // This will enable Alpha to Coverage.
            // Alpha to coverage is a technique that uses the alpha of the fragment to decide whether it will be drawn or not.
            // Without Multisample Anti-Aliasing, an alpha above 0.5 will allow the pixel to be drawn and an alpha below 0.5 will discard the pixel.
            // With Multisample Anti-Aliasing, the alpha levels will control how many samples in the frame buffer will be overwritten by the pixel.
            this.gl.enable(this.gl.SAMPLE_ALPHA_TO_COVERAGE);
        } else {
            this.gl.disable(this.gl.SAMPLE_ALPHA_TO_COVERAGE);
        }
        
        this.program.use();
        const VP = this.camera.ViewProjectionMatrix;

        let renderers = this.renderers.slice();
        if(this.sortRenderers){
            // Sorting will put opaque objects first followed by transparent objects.
            // Then opaque objects are sorted from near to far and transparent objects are sorted from far to near.
            renderers.sort((a, b) => {
                if(!a.transparent && b.transparent){
                    return -1
                } else if(a.transparent && !b.transparent) {
                    return 1;
                } else {
                    const distance_a = vec3.sqrDist(a.position, this.camera.position);
                    const distance_b = vec3.sqrDist(b.position, this.camera.position);
                    return (a.transparent && b.transparent) ? distance_b - distance_a : distance_a - distance_b;
                }
            })
        }

        for(let renderer of renderers){
            if(!renderer.transparent || this.depthTesting){
                this.gl.enable(this.gl.DEPTH_TEST);
            } else {
                this.gl.disable(this.gl.DEPTH_TEST);
            }

            if(renderer.transparent && this.blendingEnabled){
                // it the object is transparent and we want blending, we enable blending
                this.gl.enable(this.gl.BLEND);
                // We give WebGL the blending equation. The options are:
                // - gl.FUNC_ADD: the equation will be (srcFactor * srcPixel + dstFactor * dstPixel)
                // - gl.FUNC_SUBTRACT: the equation will be (srcFactor * srcPixel - dstFactor * dstPixel)
                // - gl.FUNC_REVERSE_SUBTRACT:  the equation will be (dstFactor * dstPixel - srcFactor * srcPixel)
                // - gl.MIN: the equation will be min(srcFactor * srcPixel, dstFactor * dstPixel)
                // - gl.MAX: the equation will be max(srcFactor * srcPixel, dstFactor * dstPixel)
                this.gl.blendEquation(this.blendEquation);
                // Then, we tell WebGL the source factor and destination factor. The optios for both are:
                // - gl.ZERO: (0, 0, 0, 0)
                // - gl.ONE:(1, 1, 1, 1)
                // - gl.SRC_COLOR: (source.r, source.g, source.b, source.a)
                // - gl.ONE_MINUS_SRC_COLOR: (1-source.r, 1-source.g, 1-source.b, 1-source.a)
                // - gl.DST_COLOR: (destination.r, destination.g, destination.b, destination.a)
                // - gl.ONE_MINUS_DST_COLOR: (1-destination.r, 1-destination.g, 1-destination.b, 1-destination.a)
                // - gl.SRC_ALPHA: (source.a, source.a, source.a, source.a)
                // - gl.ONE_MINUS_SRC_ALPHA: (1-source.a, 1-source.a, 1-source.a, 1-source.a)
                // - gl.DST_ALPHA: (destination.a, destination.a, destination.a, destination.a)
                // - gl.ONE_MINUS_DST_ALPHA: (1-destination.a, 1-destination.a, 1-destination.a, 1-destination.a)
                // - gl.CONSTANT_COLOR: (constant.r, constant.g, constant.b, constant.a)
                // - gl.ONE_MINUS_CONSTANT_COLOR: (1-constant.r, 1-constant.g, 1-constant.b, 1-constant.a)
                // - gl.CONSTANT_ALPHA: (constant.a, constant.a, constant.a, constant.a)
                // - gl.ONE_MINUS_CONSTANT_ALPHA: (1-constant.a, 1-constant.a, 1-constant.a, 1-constant.a)
                // - gl.SRC_ALPHA_SATURATE: (min(source.a, 1-destination.a), min(source.a, 1-destination.a), min(source.a, 1-destination.a), 1)
                this.gl.blendFunc(this.srcFactor, this.dstFactor);
                // Here we set the constant color used by gl.CONSTANT_COLOR, gl.ONE_MINUS_CONSTANT_COLOR, gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA
                this.gl.blendColor(this.constantColor[0], this.constantColor[1], this.constantColor[2], this.constantColor[3]);
            } else {
                this.gl.disable(this.gl.BLEND);
            }

            let M = mat4.fromRotationTranslationScale(mat4.create(), renderer.rotation, renderer.position, renderer.scale);
            let MVP = mat4.mul(mat4.create(), VP, M);
            this.program.setUniformMatrix4fv("MVP", false, MVP);
            this.program.setUniform4f("tint", renderer.tint);

            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, renderer.texture);
            this.program.setUniform1i('texture_sampler', 0);
            this.gl.bindSampler(0, renderer.sampler);

            renderer.mesh.draw(this.gl.TRIANGLES);
        }

        // One caveat of blending on WebGL is that if the frame buffer alpha values are less than 1, the browser will blend the canvas with page background
        // This feature could be useful, be we don't want it here
        // So we use the color mask to clear the alpha channel only (set the alpha of all the pixels to 1)
        this.gl.colorMask(false, false, false, true); // Disable writing to rgb channels only (a is still modifiable)
        this.gl.clear(this.gl.COLOR_BUFFER_BIT); // clear the color. This will not touch the rgb channels since they are masked, so only a is cleared
        this.gl.colorMask(true, true, true, true); // Enable writing to all the channels again
        
    }
    
    public end(): void {
        this.program.dispose();
        this.program = null;
        for(let key in this.meshes)
            this.meshes[key].dispose();
        this.meshes = {};
        for(let key in this.textures)
            this.gl.deleteTexture(this.textures[key]);
        this.textures = {};
        this.gl.deleteSampler(this.sampler);
        this.clearControls();
    }


    /////////////////////////////////////////////////////////
    ////// ADD CONTROL TO THE WEBPAGE (NOT IMPORTNANT) //////
    /////////////////////////////////////////////////////////
    private setupControls() {
        const controls = document.querySelector('#controls');
        
        const blendEquationOptions = {
            [this.gl.FUNC_ADD]:"FUNC_ADD",
            [this.gl.FUNC_SUBTRACT]:"FUNC_SUBTRACT",
            [this.gl.FUNC_REVERSE_SUBTRACT]:"FUNC_REVERSE_SUBTRACT",
            [this.gl.MIN]:"MIN",
            [this.gl.MAX]:"MAX"
        };

        const blendFactorOptions = {
            [this.gl.ZERO]:"ZERO",
            [this.gl.ONE]:"ONE",
            [this.gl.SRC_COLOR]:"SRC_COLOR",
            [this.gl.ONE_MINUS_SRC_COLOR]:"ONE_MINUS_SRC_COLOR",
            [this.gl.DST_COLOR]:"DST_COLOR",
            [this.gl.ONE_MINUS_DST_COLOR]:"ONE_MINUS_DST_COLOR",
            [this.gl.SRC_ALPHA]:"SRC_ALPHA",
            [this.gl.ONE_MINUS_SRC_ALPHA]:"ONE_MINUS_SRC_ALPHA",
            [this.gl.DST_ALPHA]:"DST_ALPHA",
            [this.gl.ONE_MINUS_DST_ALPHA]:"ONE_MINUS_DST_ALPHA",
            [this.gl.CONSTANT_COLOR]:"CONSTANT_COLOR",
            [this.gl.ONE_MINUS_CONSTANT_COLOR]:"ONE_MINUS_CONSTANT_COLOR",
            [this.gl.CONSTANT_ALPHA]:"CONSTANT_ALPHA",
            [this.gl.ONE_MINUS_CONSTANT_ALPHA]:"ONE_MINUS_CONSTANT_ALPHA",
            [this.gl.SRC_ALPHA_SATURATE]:"SRC_ALPHA_SATURATE"
        };

        controls.appendChild(
            <div>
                <div className="control-row">
                    <input type="checkbox" checked={this.blendingEnabled?true:undefined} onchange={(ev: InputEvent)=>{this.blendingEnabled = ((ev.target as HTMLInputElement).checked)}}/>
                    <label className="control-label">Blending: </label>
                    <Selector options={blendEquationOptions} value={this.blendEquation.toString()} onchange={(v) => {this.blendEquation = Number.parseInt(v)}}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Source Factor: </label>
                    <Selector options={blendFactorOptions} value={this.srcFactor} onchange={(v) => {this.srcFactor = Number.parseInt(v)}}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Destination Factor: </label>
                    <Selector options={blendFactorOptions} value={this.dstFactor} onchange={(v) => {this.dstFactor = Number.parseInt(v)}}/>
                </div>
                <div className="control-row">
                    <label className="control-label">Constant Color:</label>
                    <Color color={this.constantColor} />
                </div>
                <div className="control-row">
                    <CheckBox value={this.sortRenderers} onchange={(v)=>{this.sortRenderers = v}}/>
                    <label className="control-label">Sort Renderers</label>
                    <CheckBox value={this.backFaceCulling} onchange={(v)=>{this.backFaceCulling = v}}/>
                    <label className="control-label">BackFace Culling</label>
                    <CheckBox value={this.depthTesting} onchange={(v)=>{this.depthTesting = v}}/>
                    <label className="control-label">Depth Testing</label>
                </div>
                <div className="control-row">
                    <CheckBox value={this.alphaToCoverage} onchange={(v)=>{this.alphaToCoverage = v}}/>
                    <label className="control-label">Alpha To Coverage</label>
                </div>
            </div>
            
        );
        
    }

    private clearControls() {
        const controls = document.querySelector('#controls');
        controls.innerHTML = "";
    }


}