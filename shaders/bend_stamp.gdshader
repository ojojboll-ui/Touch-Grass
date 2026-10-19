shader_type canvas_item;

// One touch in the bend field. Blades round the touch are pushed outward
// from it and dragged along the way it moves; under its centre they are
// pressed down. rg holds the push (0.5 = none), b the press, alpha how much
// of this replaces what was there.

uniform vec2 drag = vec2(0.0);
uniform float press = 0.0;
uniform float strength = 0.5;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float fall = 1.0 - smoothstep(0.0, 1.0, r);
	vec2 radial = r > 1e-3 ? p / r : vec2(0.0);
	float ring = smoothstep(0.0, 0.4, r);
	vec2 push = clamp(radial * ring * 0.75 + drag * 0.7, vec2(-1.0), vec2(1.0));
	COLOR = vec4(0.5 + 0.5 * push, press * fall, fall * strength);
}
