shader_type spatial;
render_mode cull_disabled, diffuse_lambert_wrap, specular_schlick_ggx;

// Long meadow blades in the manner of Flower.
//
// Every tile of the field shares one MultiMesh with identity transforms; the
// shader places each blade itself from INSTANCE_ID and the tile's position,
// so building the field costs nothing on the CPU. A blade is a strip bent
// along a quadratic Bezier whose tip swings by one horizontal "bend" vector:
// its own droop, the steady lean of the wind, the gust passing over it, a
// flutter, and the push of the hand read from the bend field.
//
// Wind technique after Malido's "Stylized Multimesh Grass Shader" (CC0,
// godotshaders.com) and hexaquo.at's grass rendering series: a noise texture
// scrolled in world space along the wind, stronger toward the tips.

#include "res://shaders/noise.gdshaderinc"
#include "res://shaders/palette.gdshaderinc"

global uniform vec2 wind_dir;
global uniform float wind_strength;
global uniform float gust_speed;

uniform sampler2D height_tex : filter_linear, repeat_disable;
uniform float terrain_size = 400.0;
uniform sampler2D gust_tex : filter_linear, repeat_enable;
uniform sampler2D bend_tex : filter_linear, repeat_disable;
uniform float bend_size = 32.0;
uniform vec2 bend_center = vec2(0.0);

uniform float tile_size = 5.0;
uniform float per_side = 90.0;
uniform float max_density = 324.0;   // blades per m² this LOD can hold
uniform vec2 cam_xz = vec2(0.0);
uniform float base_width = 0.045;
uniform float sun_warmth = 0.0;      // set by the time of day, tints the tips

varying float along;
varying float gust_v;
varying vec3 low_col;
varying vec3 high_col;
varying float shade;
varying float far;

float density_at(float d) {
	return max(320.0 * exp(-max(d - 8.0, 0.0) / 8.0), 2.5);
}

float gust_at(vec2 p) {
	vec2 wd = normalize(wind_dir);
	vec2 q = p - wd * TIME * gust_speed;
	float n = texture(gust_tex, q * 0.010).r * 0.65 + texture(gust_tex, q * 0.031 + vec2(0.3, 0.7)).r * 0.35;
	return smoothstep(0.45, 0.80, n);
}

void vertex() {
	float id = float(INSTANCE_ID);
	float iz = floor(id / per_side);
	float ix = id - iz * per_side;
	vec2 tile0 = NODE_POSITION_WORLD.xz;
	vec2 cell = vec2(ix, iz);
	vec2 r2 = hash22(cell * 1.618 + tile0 * 0.37);
	vec2 root = tile0 + (cell + r2) * (tile_size / per_side);

	float d = distance(root, cam_xz);
	float dens = min(density_at(d), max_density);
	float rnd = hash12(root * 3.17 + 0.5);
	float alive = step(rnd, dens / max_density);
	float wide = clamp(sqrt(320.0 / dens), 1.0, 2.2);

	float h0 = textureLod(height_tex, root / terrain_size + 0.5, 0.0).r;
	float lush = lush_at(root);
	float r3 = hash12(root * 7.31 + 1.7);
	float L = mix(0.42, 1.05, lush) * (0.7 + 0.6 * r3) * mix(1.0, 0.55, smoothstep(15.0, 60.0, d));

	float yaw = hash12(root * 5.13 + 3.1) * TAU;
	vec2 face = vec2(cos(yaw), sin(yaw));
	float yaw2 = hash12(root * 2.71 + 8.3) * TAU;
	vec2 droop = vec2(cos(yaw2), sin(yaw2)) * mix(0.12, 0.6, r3 * r3);

	vec2 wd = normalize(wind_dir);
	vec2 wp = vec2(-wd.y, wd.x);
	float g = gust_at(root);
	float ph = hash12(root * 9.7) * TAU;
	float flutter = sin(TIME * (2.2 + r3 * 1.6) + ph + dot(root, wd) * 1.3);
	float flutter2 = sin(TIME * (3.1 + r3) + ph * 1.7);
	vec2 v = droop
		+ wd * wind_strength * (0.25 + 1.25 * g)
		+ wd * flutter * 0.07 * (0.4 + g)
		+ wp * flutter2 * 0.05;

	vec2 buv = (root - bend_center) / bend_size + 0.5;
	float inside = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
	vec4 b = textureLod(bend_tex, buv, 0.0);
	vec2 push = (b.rg - 0.5) * 2.0 * inside;
	float press = clamp(b.b, 0.0, 1.0) * inside;
	v = v * (1.0 - 0.6 * min(length(push), 1.0)) + push * 1.5;
	float vl = max(length(v), 1e-4);
	float a = min(vl + press * 0.9, 1.5);
	vec2 dir = v / vl;

	float t = UV.y;
	float s = VERTEX.x;
	vec3 hd = vec3(dir.x, 0.0, dir.y);
	vec3 P1 = hd * sin(a) * L * 0.18 + vec3(0.0, L * 0.55, 0.0);
	vec3 P2 = hd * sin(a) * L + vec3(0.0, cos(a) * L, 0.0);
	vec3 pos = 2.0 * (1.0 - t) * t * P1 + t * t * P2;
	vec3 tan = normalize(2.0 * (1.0 - t) * P1 + 2.0 * t * (P2 - P1) + vec3(0.0, 1e-4, 0.0));
	vec3 side = vec3(face.x, 0.0, face.y);
	float w = base_width * wide * (0.75 + 0.5 * r2.x);
	pos += side * s * w * pow(1.0 - t, 0.6);
	vec3 n = normalize(cross(side, tan));

	vec3 world = vec3(root.x, h0 - 0.03, root.y) + pos * alive;
	VERTEX = world - NODE_POSITION_WORLD;
	NORMAL = normalize(mix(n, vec3(0.0, 1.0, 0.0), mix(0.55, 0.9, smoothstep(10.0, 45.0, d))));

	along = t;
	gust_v = g;
	low_col = grass_low(root);
	high_col = grass_high(root) * (0.85 + 0.3 * r2.y);
	shade = r3;
	far = smoothstep(10.0, 45.0, d);
}

void fragment() {
	vec3 col = mix(low_col, high_col, smoothstep(0.0, 0.85, along));
	col *= mix(mix(0.35, 0.85, far), 1.0, smoothstep(0.0, 0.55, along));
	// a gust bends the blades over and their sheen runs across the field
	col *= 1.0 + gust_v * 0.28 * along;
	col = mix(col, col * vec3(1.15, 1.0, 0.7), sun_warmth * along);
	// far off the blades melt into the colour the ground takes there
	col = mix(col, high_col * 0.7, far * 0.6);
	ALBEDO = col;
	BACKLIGHT = col * mix(1.1, 0.4, far) * along;
	ROUGHNESS = 0.5;
	SPECULAR = (0.35 + gust_v * 0.2) * (1.0 - far);
}
