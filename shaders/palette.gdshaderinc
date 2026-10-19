// Grass colours, shared by the blades and the ground under them so the two
// fade into each other. Large soft patches go dry and golden, as in Flower's
// pale meadows next to the green ones.

float dry_at(vec2 xz) {
	return smoothstep(0.5, 0.72, fbm2(xz * 0.022 + vec2(7.3, 2.1)));
}

float lush_at(vec2 xz) {
	return fbm2(xz * 0.06 + vec2(3.7, 11.2));
}

vec3 grass_low(vec2 xz) {
	return mix(vec3(0.018, 0.05, 0.010), vec3(0.11, 0.09, 0.03), dry_at(xz));
}

vec3 grass_high(vec2 xz) {
	vec3 green = mix(vec3(0.20, 0.36, 0.03), vec3(0.36, 0.48, 0.045), lush_at(xz));
	return mix(green, vec3(0.56, 0.44, 0.11), dry_at(xz));
}
