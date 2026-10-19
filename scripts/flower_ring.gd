extends Node3D
## The chord wheel: twelve flowers in a ring on the grass, on the left of the
## picture under the left hand, in the circle of fifths with C at the top.
##
## The left hand's place round the ring picks the root; its extended fingers
## pick the kind, as the Omnichord's three rows of buttons: one finger major,
## two minor, three seventh, an open hand major. A fist keeps the chord (and
## the hand lifts out of the grass anyway). Inside the middle of the ring
## nothing changes, so the hand can rest there.
##
## Like the strings the ring is laid out in screen space and cast onto the
## grass, so it stays under the left hand in every camera view.

signal chord_changed(root: int, quality: int, name: String)

const CENTER := Vector2(0.24, 0.56)    # screen position of the ring's middle (x of width, y of height)
const RADIUS := 0.2                     # of the picture's height
const DEAD := 0.35                      # share of the radius that changes nothing
const ROOTS := [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]    # clockwise from the top: C G D A E B Gb Db Ab Eb Bb F
const NAMES := ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
const SUFFIX := ["", "m", "7"]
const COLORS := [Color(1.0, 0.80, 0.22), Color(0.66, 0.56, 1.0), Color(1.0, 0.36, 0.24)]
const HOVER := 0.95                     # flowers float at the grass tips

var terrain: Node3D
var cam: Camera3D
var synth: Object
var sector := 0
var quality := 0
var _flowers: Array[Node3D] = []
var _petals: Array = []                 # per flower, Array of ShaderMaterial
var _labels: Array[Label3D] = []
var _glow := PackedFloat32Array()
var _pending_q := 0
var _pending_for := 0.0
var _last_cam := Transform3D()


func build(terrain_node: Node3D, camera: Camera3D) -> void:
	terrain = terrain_node
	cam = camera
	var shader: Shader = load("res://shaders/petal.gdshader")
	var quad := QuadMesh.new()
	quad.size = Vector2(0.32, 0.62)
	quad.center_offset = Vector3(0, 0.31, 0)
	var heart := SphereMesh.new()
	heart.radius = 0.09
	heart.height = 0.12
	var heart_mat := StandardMaterial3D.new()
	heart_mat.albedo_color = Color(1.0, 0.75, 0.25, 0.8)
	heart_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	heart_mat.emission_enabled = true
	heart_mat.emission = Color(1.0, 0.7, 0.2)
	heart_mat.emission_energy_multiplier = 0.4
	for k in 12:
		var f := Node3D.new()
		add_child(f)
		var mats := []
		for p in 6:
			var mi := MeshInstance3D.new()
			mi.mesh = quad
			var m := ShaderMaterial.new()
			m.shader = shader
			mi.material_override = m
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			# petals round the heart, tipped up out of the grass
			mi.rotation = Vector3(deg_to_rad(-62.0), TAU * p / 6.0, 0.0)
			mi.rotation_order = EULER_ORDER_YXZ
			f.add_child(mi)
			mats.append(m)
		var h := MeshInstance3D.new()
		h.mesh = heart
		h.material_override = heart_mat
		f.add_child(h)
		var label := Label3D.new()
		label.text = NAMES[ROOTS[k]]
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 80
		label.pixel_size = 0.006
		label.outline_size = 18
		label.modulate = Color(1, 1, 1, 0.7)
		label.outline_modulate = Color(0.05, 0.12, 0.03, 0.75)
		label.position = Vector3(0, 0.55, 0)
		label.no_depth_test = true
		f.add_child(label)
		_flowers.append(f)
		_petals.append(mats)
		_labels.append(label)
	_glow.resize(12)
	_place()


## The ring's flowers sit where their screen positions meet the grass tips.
func _place() -> void:
	var vp := get_viewport().get_visible_rect().size
	var span := 0.0
	for k in 12:
		var a := TAU * k / 12.0
		var sp := Vector2(CENTER.x * vp.x + sin(a) * RADIUS * vp.y, CENTER.y * vp.y - cos(a) * RADIUS * vp.y)
		var from := cam.project_ray_origin(sp)
		var dir := cam.project_ray_normal(sp)
		var hit: Variant = terrain.ray_hit(from, dir, 200.0, HOVER)
		if hit != null:
			_flowers[k].global_position = hit
	# flower size follows the ring's size on the ground
	span = _flowers[0].global_position.distance_to(_flowers[6].global_position)
	var s := clampf(span / 6.0, 0.4, 6.0)
	for f in _flowers:
		f.set_meta("base", s)
		f.scale = Vector3.ONE * s * float(f.get_meta("sel", 1.0))


func update(hand_pos: Vector2, present: bool, fingers: int, fist: bool, delta: float) -> void:
	if cam.global_transform != _last_cam:
		_last_cam = cam.global_transform
		_place()
	if present and not fist:
		var vp := get_viewport().get_visible_rect().size
		var d := Vector2((hand_pos.x - CENTER.x) * vp.x / vp.y, hand_pos.y - CENTER.y)
		if d.length() > RADIUS * DEAD:
			var a := fposmod(atan2(d.x, -d.y), TAU)
			var s := int(round(a / (TAU / 12.0))) % 12
			# hysteresis: stay on the current flower until well past halfway
			var cur_a := TAU * sector / 12.0
			var off := absf(wrapf(a - cur_a, -PI, PI))
			if s != sector and off > TAU / 12.0 * 0.62:
				sector = s
				_send()
		var q := 1 if fingers == 2 else (2 if fingers == 3 else 0)
		# a finger count must hold a moment, or passing through two fingers on the way to three flickers minor
		if q != _pending_q:
			_pending_q = q
			_pending_for = 0.0
		_pending_for += delta
		if _pending_q != quality and _pending_for > 0.15:
			quality = _pending_q
			_send()
	_draw_ring(present and not fist, delta)


func current_name() -> String:
	return NAMES[ROOTS[sector]] + SUFFIX[quality]


func _send() -> void:
	if synth:
		synth.set_chord(ROOTS[sector], quality)
	_glow[sector] = 1.0
	chord_changed.emit(ROOTS[sector], quality, current_name())


func _draw_ring(active: bool, delta: float) -> void:
	for k in 12:
		var sel := k == sector
		_glow[k] = move_toward(_glow[k], 0.0, delta * 1.5)
		var col: Color = COLORS[quality] if sel else Color(1.0, 0.97, 0.9)
		var alpha := (0.85 if sel else 0.32) * (1.0 if active else 0.75)
		for m in _petals[k]:
			m.set_shader_parameter("color", col)
			m.set_shader_parameter("alpha", alpha)
			m.set_shader_parameter("glow", (0.35 if sel else 0.0) + _glow[k])
		var target := 1.35 if sel else 1.0
		var now: float = lerpf(_flowers[k].get_meta("sel", 1.0), target, 1.0 - exp(-delta / 0.15))
		_flowers[k].set_meta("sel", now)
		_flowers[k].scale = Vector3.ONE * float(_flowers[k].get_meta("base", 1.0)) * now
		_labels[k].text = NAMES[ROOTS[k]] + (SUFFIX[quality] if sel else "")
		_labels[k].modulate.a = 0.95 if sel else 0.55
