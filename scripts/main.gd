extends Node3D
## Touch Grass. Builds the meadow, sky and camera in code.
##
## The hands come from handtrack (hand_input.gd starts it if it is not running).
## While no hand is in view the mouse stands in for one: hover to stroke the
## grass, hold the left button to press it down.
##
## Run with `-- --snapshot=path.png` to render a frame to disk and quit.
## Other flags: --cam=0..3 --hour=15 --stroke --frames=150 --bench --noui
## --nolaunch (never start handtrack; tests feed tools/fake_hands.py instead)
## --strum (test sweeps while it runs) --wav=path (record the Master bus there)

const Terrain := preload("res://scripts/terrain.gd")
const GrassField := preload("res://scripts/grass_field.gd")
const BendField := preload("res://scripts/bend_field.gd")
const TimeOfDay := preload("res://scripts/time_of_day.gd")
const CameraRig := preload("res://scripts/camera_rig.gd")
const UI := preload("res://scripts/ui.gd")
const HandInput := preload("res://scripts/hand_input.gd")
const HandView := preload("res://scripts/hand_view.gd")
const Sound := preload("res://scripts/sound.gd")
const StrumPlate := preload("res://scripts/strum_plate.gd")
const ChordWheel := preload("res://scripts/chord_wheel.gd")
const Pollen := preload("res://scripts/pollen.gd")

var terrain: Node3D
var grass: Node3D
var bend: SubViewport
var tod: Node3D
var cam: Camera3D
var ui: CanvasLayer
var orb: MeshInstance3D
var hand_input: Node
var hand_views := {}
var sound: Node
var strum: Node
var ring: Control
## Doppa: the right hand only strums once it has sunk into the grass (reached
## toward the webcam). D toggles it against plain hovering, to compare.
var dip_mode := true
var _dip_on := false
const DIP_ON := 0.22
const DIP_OFF := 0.12
var pollen: Node3D

var args := {}
var _hand_pos := Vector3.ZERO
var _hand_vel := Vector2.ZERO
var _hand_on := false
var _scripted := false
var _scripted_x := 0.5


func _ready() -> void:
	args = _parse_args()
	var t0 := Time.get_ticks_msec()

	terrain = Terrain.new()
	add_child(terrain)
	terrain.build()

	bend = BendField.new()
	add_child(bend)

	var gust := NoiseTexture2D.new()
	gust.width = 256
	gust.height = 256
	gust.seamless = true
	var gn := FastNoiseLite.new()
	gn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	gn.frequency = 0.012
	gn.fractal_octaves = 3
	gn.seed = 3
	gust.noise = gn

	grass = GrassField.new()
	add_child(grass)
	grass.build(terrain, gust, bend.get_texture(), bend.SIZE_M)
	grass.visible = not args.has("nograss")

	tod = TimeOfDay.new()
	add_child(tod)
	tod.build(grass)

	cam = CameraRig.new()
	cam.terrain = terrain
	cam.near = 0.05
	cam.far = 600.0
	add_child(cam)
	cam.current = true

	orb = _make_orb()
	add_child(orb)

	sound = Sound.new()
	add_child(sound)
	strum = StrumPlate.new()
	strum.synth = sound.synth
	add_child(strum)
	pollen = Pollen.new()
	add_child(pollen)
	strum.plucked.connect(_on_pluck)

	hand_input = HandInput.new()
	if args.has("nolaunch"):
		hand_input.set("_tried_launch", true)
	add_child(hand_input)
	for label in ["left", "right"]:
		var hv := HandView.new()
		add_child(hv)
		hv.setup(label, terrain, cam)
		hand_views[label] = hv

	ui = UI.new()
	add_child(ui)
	ui.build(cam, tod)
	ring = ChordWheel.new()
	ring.synth = sound.synth
	ui.add_child(ring)
	ui.move_child(ring, 0)
	ui.panel.visible = not args.has("noui")

	if args.has("hour"):
		tod.hour = float(args["hour"])
	if args.has("cam"):
		cam.go_to(int(args["cam"]), true)
	print("built in ", Time.get_ticks_msec() - t0, " ms")

	if args.has("bench"):
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	if args.has("snapshot"):
		_run_snapshot()


func _process(delta: float) -> void:
	grass.follow_camera(cam.focus())
	terrain.material.set_shader_parameter("cam_xz", Vector2(cam.focus().x, cam.focus().z))
	_follow_view()
	var touches := []
	var any_hand := false
	for label in hand_views:
		var hv: Node3D = hand_views[label]
		hv.update_hand(hand_input.hand(label), delta)
		touches.append_array(hv.touches)
		any_hand = any_hand or hand_input.hand(label).get("present", false)
	var line: String = "Händer:  " + hand_input.status
	if sound.synth == null:
		line += "   ·   inget ljud (GrassSynth saknas)"
	else:
		line += "   ·   ackord " + ring.current_name()
	line += "   ·   " + ("doppa för att spela (D)" if dip_mode else "sväva (D)")
	ui.set_status(line)
	if args.has("handcam"):
		# test view: a close look at one hand from behind and above, or from the side
		var hv: Node3D = hand_views[args["handcam"]]
		cam.set_process(false)
		var off := Vector3(0.0, 1.0, 2.2) if not args.has("side") else Vector3(2.4, 0.5, 0.0)
		cam.look_at_from_position(hv.global_position + off, hv.global_position, Vector3.UP)
	if any_hand:
		_hand_on = false
	elif not _scripted:
		_mouse_hand(delta)
	_play(any_hand, delta)
	if _hand_on:
		var speed := _hand_vel.length()
		var drag: Vector2 = _hand_vel / max(speed, 0.001) * clamp(speed / 3.0, 0.0, 1.0)
		var press := 1.0 if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or _scripted else 0.0
		touches.append({"pos": _hand_pos, "radius": 0.9, "drag": drag, "press": press, "strength": 0.3})
	bend.set_touches(touches)
	grass.set_param("bend_center", bend.center)
	orb.visible = _hand_on
	orb.global_position = _hand_pos + Vector3(0, 0.55, 0)


## The right hand strums the plate, the left picks chords on the chord wheel.
## With no hands in view the mouse strums while its left button is held.
func _play(any_hand: bool, delta: float) -> void:
	var r: Node3D = hand_views["right"]
	var l: Node3D = hand_views["left"]
	ring.update(l.screen_pos, l.present, l.fingers, l.lifted > 0.5, delta)
	if any_hand:
		var depth := clampf(r.dip, 0.0, 1.0)
		_dip_on = r.present and r.dip > (DIP_OFF if _dip_on else DIP_ON)
		var playing: bool = r.present and r.lifted < 0.5 and (_dip_on or not dip_mode)
		strum.update(r.screen_pos.x, playing, depth, delta)
		# deeper in the grass is louder (in the pluck strength) and brighter
		if sound.synth and sound.synth.has_method("set_tone"):
			sound.synth.set_tone(0.3 + 0.7 * depth)
	else:
		var vp := get_viewport().get_visible_rect().size
		var mx := get_viewport().get_mouse_position().x / vp.x
		if _scripted:
			mx = _scripted_x
		strum.update(mx, (_hand_on and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)) or _scripted, 0.4, delta)


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k and k.pressed and not k.echo and k.keycode == KEY_D:
		dip_mode = not dip_mode


func _on_pluck(_string_index: int, velocity: float) -> void:
	var r: Node3D = hand_views["right"]
	var at: Vector3 = r.global_position if r.present else _hand_pos + Vector3(0, 0.5, 0)
	pollen.burst(at, ring.COLORS[ring.quality].lerp(Color(1, 1, 0.9), 0.4), 0.6 + velocity)


func _mouse_hand(delta: float) -> void:
	var mp := get_viewport().get_mouse_position()
	var from := cam.project_ray_origin(mp)
	var dir := cam.project_ray_normal(mp)
	var hit: Variant = terrain.ray_hit(from, dir, 120.0)
	var inside := false
	if hit != null:
		var h: Vector3 = hit
		var half: float = bend.SIZE_M * 0.5 - 1.0
		inside = abs(h.x - bend.center.x) < half and abs(h.z - bend.center.y) < half
		if inside:
			_move_hand(h, delta)
	_hand_on = inside


## Centre the bend field on the meadow in the middle of the picture once a
## camera glide has settled.
func _follow_view() -> void:
	if cam.gliding():
		return
	var mid := get_viewport().get_visible_rect().size * Vector2(0.5, 0.62)
	var hit: Variant = terrain.ray_hit(cam.project_ray_origin(mid), cam.project_ray_normal(mid), 120.0)
	if hit == null:
		return
	var h: Vector3 = hit
	var c := Vector2(round(h.x), round(h.z))
	if c.distance_to(bend.center) > 4.0:
		bend.center = c


func _move_hand(p: Vector3, delta: float) -> void:
	if _hand_on and delta > 0.0:
		var v := Vector2(p.x - _hand_pos.x, p.z - _hand_pos.z) / delta
		_hand_vel = _hand_vel.lerp(v, 0.3)
	else:
		_hand_vel = Vector2.ZERO
	_hand_pos = p


func _make_orb() -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = 0.12
	m.height = 0.24
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1.0, 0.97, 0.85, 0.55)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.9, 0.7)
	mat.emission_energy_multiplier = 2.0
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	return mi


func _run_snapshot() -> void:
	var frames := int(args.get("frames", 150))
	if args.has("wav"):
		sound.start_recording()
	var fps_sum := 0.0
	var fps_n := 0
	for i in frames:
		if args.has("strum") and i % 90 == 10:
			sound.test_strum()
		if args.has("spacekey") and i % 90 == 10:
			# the real path: a Space key event through the input system
			var ev := InputEventKey.new()
			ev.keycode = KEY_SPACE
			ev.physical_keycode = KEY_SPACE
			ev.pressed = true
			Input.parse_input_event(ev)
			var up := ev.duplicate()
			up.pressed = false
			Input.parse_input_event(up)
		if args.has("stroke"):
			# sweep the stand-in hand across the meadow in front of the camera, ending mid-field
			_scripted = true
			var t := float(i) / frames
			var p := Vector3(lerpf(-5.0, 3.0, t), 0.0, -1.5 + sin(t * TAU) * 1.2)
			p.y = terrain.height_at(p.x, p.z)
			_move_hand(p, get_process_delta_time())
			_hand_on = true
		await get_tree().process_frame
		if i > frames / 2:
			fps_sum += Engine.get_frames_per_second()
			fps_n += 1
	await RenderingServer.frame_post_draw
	print("bend rest: ", bend.get_texture().get_image().get_pixel(4, 4), "  hands: ", hand_input.status)
	if args.has("wav"):
		sound.save_recording(args["wav"])
	var img := get_viewport().get_texture().get_image()
	img.save_png(args["snapshot"])
	print("snapshot saved: ", args["snapshot"], "  (", snappedf(fps_sum / max(fps_n, 1), 0.1), " fps)")
	get_tree().quit()


func _parse_args() -> Dictionary:
	var out := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--") and a.contains("="):
			var kv := a.substr(2).split("=", true, 1)
			out[kv[0]] = kv[1]
		elif a.begins_with("--"):
			out[a.substr(2)] = "1"
	return out
