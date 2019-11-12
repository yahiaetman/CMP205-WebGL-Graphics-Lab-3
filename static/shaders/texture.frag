#version 300 es
precision highp float;

in vec4 v_color;
in vec2 v_texcoord;

out vec4 color;

uniform vec4 tint;
uniform sampler2D texture_sampler;

void main(){
    color = texture(texture_sampler, v_texcoord) * v_color * tint; // Send our interpolated color
}