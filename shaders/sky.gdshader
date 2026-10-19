shader_type sky;

// A soft painted sky: a gradient from horizon to zenith, the sun with a wide
// warm halo, slow drifting clouds lit from the sun's side, and stars once it
// is dark. All colours come from the time of day.

#include "res://shaders/noise.gdshaderinc"

uniform vec3 top_color : source_color = vec3(0.25, 0.5, 0.9);
uniform vec3 horizon_color : source_color = vec3(0.75, 0.85, 0.95);
uniform vec3 below_color : source_color = vec3(0.35, 0.42, 0.3);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.85);
uniform vec3 cloud_lit : source_color = vec3(1.0, 1.0, 1.0);
uniform vec3 cloud_shade : source_color = vec3(0.6, 0.66, 0.78);
uniform float halo = 0.4;
uniform float cloud_cover = 0.45;
uniform float stars = 0.0;
uniform vec3 moon_dir = vec3(0.0, 0.5, -1.0);
uniform float moon = 0.0;

void sky() {
	vec3 d = EYEDIR;
	float h = d.y;
	vec3 col = mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.55));
	if (h < 0.0) {
		col = mix(horizon_color, below_color, smoothstep(0.0, 0.25, -h));
	}

	vec3 sd = LIGHT0_DIRECTION;
	float sdot = max(dot(d, sd), 0.0);
	col += sun_color * halo * (pow(sdot, 8.0) * 0.35 + pow(sdot, 64.0) * 0.6);
	if (!AT_CUBEMAP_PASS) {
		col += sun_color * smoothstep(0.9993, 0.9997, sdot) * 6.0 * step(-0.05, sd.y);
	}

	if (h > 0.0) {
		vec2 uv = d.xz / (h + 0.12) * 0.55 + vec2(TIME * 0.004, TIME * 0.0015);
		float n = fbm2(uv * 2.2) * 0.75 + fbm2(uv * 6.5 + 3.0) * 0.25;
		float cover = smoothstep(1.0 - cloud_cover, 1.15 - cloud_cover * 0.6, n);
		cover *= smoothstep(0.0, 0.12, h);
		float lit = clamp(0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0001)), normalize(vec3(sd.x, 0.0, sd.z) + vec3(0.0001))), 0.0, 1.0);
		vec3 cc = mix(cloud_shade, cloud_lit, mix(0.35, 1.0, lit) * smoothstep(0.2, 1.0, n));
		col = mix(col, cc, cover * 0.85);

		float st = pow(hash12(floor(d.xz / (h + 0.3) * 260.0)), 400.0) * smoothstep(0.05, 0.3, h);
		col += vec3(st * stars * 2.0) * (1.0 - cover);
		float mdot = max(dot(d, normalize(moon_dir)), 0.0);
		col += vec3(0.85, 0.9, 1.0) * moon * (smoothstep(0.9995, 0.9998, mdot) * 3.0 + pow(mdot, 200.0) * 0.25);
	}
	COLOR = col;
}
