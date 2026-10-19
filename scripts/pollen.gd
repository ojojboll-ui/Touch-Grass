extends Node3D
## A puff of glowing pollen out of the grass for every plucked string, the way
## Flower's meadow sheds light when it is touched. A few emitters take turns so
## a fast sweep's puffs overlap instead of cutting each other off.

const POOL := 10

var _emitters: Array[CPUParticles3D] = []
var _next := 0


func _ready() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(0.13, 0.13)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = _dot()
	quad.material = mat
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.0))
	fade.add_point(0.15, Color(1, 1, 1, 1.0))
	fade.set_color(fade.get_point_count() - 1, Color(1, 1, 1, 0.0))
	for k in POOL:
		var p := CPUParticles3D.new()
		p.mesh = quad
		p.emitting = false
		p.one_shot = true
		p.amount = 18
		p.lifetime = 2.2
		p.explosiveness = 0.85
		p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
		p.emission_sphere_radius = 0.25
		p.direction = Vector3.UP
		p.spread = 60.0
		p.initial_velocity_min = 0.2
		p.initial_velocity_max = 0.7
		p.gravity = Vector3(0.15, 0.12, -0.1)
		p.damping_min = 0.3
		p.damping_max = 0.6
		p.scale_amount_min = 0.6
		p.scale_amount_max = 1.4
		p.color_ramp = fade
		add_child(p)
		_emitters.append(p)


func burst(at: Vector3, color: Color, size := 1.0) -> void:
	var p := _emitters[_next]
	_next = (_next + 1) % POOL
	p.global_position = at
	p.scale = Vector3.ONE * size
	p.color = color
	p.restart()


func _dot() -> ImageTexture:
	var n := 32
	var img := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var d := Vector2(x - n / 2.0 + 0.5, y - n / 2.0 + 0.5).length() / (n / 2.0)
			var a := clampf(1.0 - d, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	return ImageTexture.create_from_image(img)
