shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_opaque, diffuse_lambert_wrap, specular_disabled;

// One petal of a chord flower: a soft-edged teardrop on a quad, pale at the
// base and coloured toward the tip, lit through from behind like Flower's.

uniform vec3 color : source_color = vec3(1.0, 0.85, 0.3);
uniform float alpha = 0.5;
uniform float glow = 0.0;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;          // x across, y from base (-1) to tip (+1)
	float t = p.y * 0.5 + 0.5;
	float half_w = sin(clamp(t, 0.0, 1.0) * 3.14159) * mix(0.55, 0.95, t);
	float edge = 1.0 - smoothstep(half_w - 0.12, half_w, abs(p.x));
	edge *= smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.94, 1.0, t));
	if (edge < 0.01) {
		discard;
	}
	vec3 c = mix(vec3(1.0, 0.98, 0.9), color, smoothstep(0.1, 0.8, t));
	ALBEDO = c * 0.8;
	BACKLIGHT = c * 0.6;
	EMISSION = c * glow;
	ALPHA = edge * alpha;
}
