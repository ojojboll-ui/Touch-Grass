shader_type canvas_item;

// Pulls the bend field back to rest. Written from the shader, not as a
// ColorRect colour, because the HDR viewport would turn a colour from sRGB to
// linear and rest (0.5) would be stored as about 0.21.

uniform float amount = 1.0;

void fragment() {
	COLOR = vec4(0.5, 0.5, 0.0, amount);
}
