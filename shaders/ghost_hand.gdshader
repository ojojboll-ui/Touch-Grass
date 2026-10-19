shader_type spatial;
render_mode blend_mix, depth_prepass_alpha, cull_back, diffuse_lambert_wrap, specular_schlick_ggx;

// A hand of glass and light. Nearly clear face-on, bright at the rim, the
// grass behind it bent a little through it. The prepass keeps the far side
// of the hand from showing through the near side, so it reads as one body.

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform vec3 tint : source_color = vec3(1.0, 0.96, 0.86);
uniform vec3 rim_color : source_color = vec3(1.0, 0.93, 0.75);
uniform float rim_power = 2.6;
uniform float body_alpha = 0.10;
uniform float rim_alpha = 0.75;
uniform float glow = 0.6;          // brightened while the hand is in the grass
uniform float refract = 0.05;

void fragment() {
	float facing = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float rim = pow(1.0 - facing, rim_power);
	vec2 off = NORMAL.xy * refract * (1.0 - facing);
	vec3 behind = textureLod(screen_tex, SCREEN_UV - off, 2.0).rgb;
	ALBEDO = tint * 0.04;
	EMISSION = behind * 0.8 + rim_color * rim * (0.6 + glow * 1.6);
	ALPHA = mix(body_alpha, rim_alpha, rim);
	ROUGHNESS = 0.15;
	SPECULAR = 0.7;
}
