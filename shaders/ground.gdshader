shader_type spatial;
render_mode diffuse_lambert_wrap;

// The soil under the blades. Near by it is the dark of a dense meadow's
// floor; far off, where the blades thin out, it takes the colour of their
// tips so the hills still read as grass through the haze.

#include "res://shaders/noise.gdshaderinc"
#include "res://shaders/palette.gdshaderinc"

uniform sampler2D height_tex : filter_linear, repeat_disable;
uniform float terrain_size = 400.0;
uniform vec2 cam_xz = vec2(0.0);

varying vec3 wpos;

float h_at(vec2 xz) {
	return textureLod(height_tex, xz / terrain_size + 0.5, 0.0).r;
}

void vertex() {
	vec2 xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
	VERTEX.y = h_at(xz);
	float e = terrain_size / 300.0;
	float dx = h_at(xz + vec2(e, 0.0)) - h_at(xz - vec2(e, 0.0));
	float dz = h_at(xz + vec2(0.0, e)) - h_at(xz - vec2(0.0, e));
	NORMAL = normalize(vec3(-dx, 2.0 * e, -dz));
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float d = distance(wpos.xz, cam_xz);
	float far = smoothstep(12.0, 70.0, d);
	float n = fbm2(wpos.xz * 0.7);
	vec3 low = grass_low(wpos.xz) * (0.8 + 0.4 * n);
	vec3 high = grass_high(wpos.xz) * (0.85 + 0.3 * fbm2(wpos.xz * 0.15));
	ALBEDO = mix(low, high * 0.6, far);
	ROUGHNESS = 0.9;
	SPECULAR = 0.2;
}
