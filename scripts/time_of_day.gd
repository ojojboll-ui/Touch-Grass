extends Node3D
## Sun, sky, fog and ambient light for any hour. The sun rises in the east,
## crosses the south (in front of the default camera, so the blades are lit
## from behind and glow) and sets in the west. After dusk the same light
## becomes the moon.

signal changed(hour: float)

var hour := 15.0:
	set(v):
		hour = fposmod(v, 24.0)
		_apply()

var light: DirectionalLight3D
var env: Environment
var sky_mat: ShaderMaterial
var grass: Node3D

# Keyed by sun elevation in degrees.
const KEYS := [
	{"elev": -18.0, "top": Color(0.010, 0.016, 0.045), "hor": Color(0.035, 0.05, 0.10), "below": Color(0.01, 0.015, 0.02),
		"light": Color(0.55, 0.65, 1.0), "energy": 0.16, "ambient": 0.35, "halo": 0.0, "stars": 1.0,
		"cloud_lit": Color(0.10, 0.12, 0.2), "cloud_shade": Color(0.03, 0.04, 0.07), "warm": 0.0, "fog": 0.006},
	{"elev": -5.0, "top": Color(0.07, 0.10, 0.25), "hor": Color(0.70, 0.45, 0.38), "below": Color(0.06, 0.06, 0.07),
		"light": Color(0.9, 0.5, 0.4), "energy": 0.05, "ambient": 0.55, "halo": 0.5, "stars": 0.35,
		"cloud_lit": Color(0.85, 0.45, 0.45), "cloud_shade": Color(0.18, 0.16, 0.28), "warm": 0.2, "fog": 0.005},
	{"elev": 4.0, "top": Color(0.28, 0.40, 0.70), "hor": Color(1.0, 0.70, 0.45), "below": Color(0.25, 0.22, 0.15),
		"light": Color(1.0, 0.62, 0.32), "energy": 1.25, "ambient": 0.8, "halo": 1.0, "stars": 0.0,
		"cloud_lit": Color(1.0, 0.78, 0.55), "cloud_shade": Color(0.55, 0.45, 0.55), "warm": 0.9, "fog": 0.0035},
	{"elev": 16.0, "top": Color(0.24, 0.47, 0.88), "hor": Color(0.90, 0.88, 0.80), "below": Color(0.3, 0.36, 0.25),
		"light": Color(1.0, 0.86, 0.66), "energy": 1.9, "ambient": 0.65, "halo": 0.6, "stars": 0.0,
		"cloud_lit": Color(1.0, 0.96, 0.9), "cloud_shade": Color(0.62, 0.66, 0.76), "warm": 0.35, "fog": 0.0022},
	{"elev": 45.0, "top": Color(0.20, 0.46, 0.95), "hor": Color(0.70, 0.84, 0.97), "below": Color(0.3, 0.38, 0.28),
		"light": Color(1.0, 0.96, 0.88), "energy": 2.2, "ambient": 0.65, "halo": 0.4, "stars": 0.0,
		"cloud_lit": Color(1.0, 1.0, 1.0), "cloud_shade": Color(0.66, 0.72, 0.84), "warm": 0.0, "fog": 0.0018},
]


func build(grass_field: Node3D) -> void:
	grass = grass_field
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = load("res://shaders/sky.gdshader")
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	sky.process_mode = Sky.PROCESS_MODE_REALTIME

	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_bloom = 0.06
	env.glow_hdr_threshold = 0.95
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_sun_scatter = 0.15
	env.fog_aerial_perspective = 0.35
	env.fog_sky_affect = 0.0
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	light = DirectionalLight3D.new()
	light.shadow_enabled = true
	light.directional_shadow_max_distance = 60.0
	light.light_angular_distance = 0.6
	add_child(light)
	_apply()


func sun_direction() -> Vector3:
	# a Swedish summer day: up at 05, south at 13, down at 21; the night is the other half turn
	var a: float
	if hour >= 5.0 and hour <= 21.0:
		a = (hour - 5.0) / 16.0 * PI
	else:
		a = PI + fposmod(hour - 21.0, 24.0) / 8.0 * PI
	var elev := sin(a) * deg_to_rad(52.0)
	if sin(a) < 0.0:
		elev = sin(a) * deg_to_rad(18.0)
	# east (+x) through south (-z) to west (-x), and round the north under the horizon
	var flat := Vector3(cos(a), 0.0, -sin(a))
	if sin(a) < 0.0:
		flat = Vector3(cos(a), 0.0, sin(a))
	return (flat * cos(elev) + Vector3.UP * sin(elev)).normalized()


func _apply() -> void:
	if light == null:
		return
	var sun := sun_direction()
	var elev := rad_to_deg(asin(sun.y))
	var k := _sample(elev)
	var dir := sun
	var night_mix := 1.0 - smoothstep(-8.0, -3.0, elev)
	if night_mix > 0.0:
		# the moon stands opposite, high in the south-west
		var moon := Vector3(-0.35, 0.55, -0.75).normalized()
		dir = sun.slerp(moon, night_mix) if sun.dot(moon) > -0.99 else moon
	light.look_at_from_position(dir * 10.0, Vector3.ZERO, Vector3.UP if abs(dir.y) < 0.99 else Vector3.FORWARD)
	light.light_color = k.light
	light.light_energy = k.energy
	light.shadow_opacity = clamp(k.energy, 0.0, 1.0)

	sky_mat.set_shader_parameter("top_color", k.top)
	sky_mat.set_shader_parameter("horizon_color", k.hor)
	sky_mat.set_shader_parameter("below_color", k.below)
	sky_mat.set_shader_parameter("sun_color", k.light)
	sky_mat.set_shader_parameter("halo", k.halo)
	sky_mat.set_shader_parameter("stars", k.stars)
	sky_mat.set_shader_parameter("cloud_lit", k.cloud_lit)
	sky_mat.set_shader_parameter("cloud_shade", k.cloud_shade)
	env.ambient_light_energy = k.ambient
	env.fog_light_color = k.hor
	env.fog_density = k.fog
	if grass:
		grass.set_param("sun_warmth", k.warm)
	changed.emit(hour)


func _sample(elev: float) -> Dictionary:
	if elev <= KEYS[0].elev:
		return KEYS[0]
	for i in range(1, KEYS.size()):
		if elev <= KEYS[i].elev:
			var a: Dictionary = KEYS[i - 1]
			var b: Dictionary = KEYS[i]
			var t := smoothstep(a.elev, b.elev, elev)
			var out := {}
			for key in a:
				out[key] = lerp(a[key], b[key], t)
			return out
	return KEYS[KEYS.size() - 1]
