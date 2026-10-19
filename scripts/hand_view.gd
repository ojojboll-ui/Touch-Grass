extends Node3D
## One tracked hand in the meadow: the CC0 hand from Godot XR Tools
## (DigitalN8m4r3, made with MakeHuman) in glass, posed from MediaPipe's
## 21 metric landmarks.
##
## Where: the palm's place in the camera image is cast as a ray from the scene
## camera onto the meadow, so the hand sits where the player sees their hand.
## It hovers at the grass tips; bringing the hand toward the webcam sinks it
## into the grass (depth only shapes, it never starts anything).
##
## How it is turned: the webcam sees the hand upright, palm to the screen.
## That pose is tipped forward round the camera's right axis (by the view's
## pitch), so an upright hand becomes one reaching over the grass, palm down,
## fingers out into the field. Its size follows its distance from the camera,
## so it fills about the same share of the picture in every view. The image is mirrored, which also mirrors the landmarks;
## the mapping flips one axis back so a left hand is a left hand.
##
## Posing: the wrist turns so the palm frame (wrist, index, middle and little
## knuckles) of the model matches the landmarks'; then every finger bone,
## parent first, swings by the shortest arc so its +Y points along its
## segment. The model keeps its own bone lengths.

const SCREEN_SHARE := 0.24     # hand length as a share of the picture's height
const HAND_LEN := 0.2          # the model's wrist-to-fingertip length in metres
# Sideways, each hand has its own centre: hands held together sit apart in the
# camera image (palms about 0.3 and 0.7 across), and they should meet in the
# middle of the picture, while shoulder width still reaches the edges.
const GAP_X := 0.19
const GAIN_X := 2.3
const GAIN_Y := 1.25
# Drawn back from the webcam the hand grows, toward the webcam it shrinks: the
# webcam's depth is the height over the meadow, the hand rising toward the
# camera above as it comes back to the player and sinking into the grass as it
# reaches out (the user's choice, the reverse of the camera image). Its image
# size against a palm at an easy playing distance, a little softened, within
# NEAR_RANGE.
const SIZE_HOME := 0.2
const NEAR_RANGE := Vector2(0.5, 2.2)
const GRASS_TOP := 0.95        # metres above the ground the palm hovers at
const DIP_RANGE := 0.7         # how far it can sink into the grass
const DEPTH_GAIN := 1.6        # dip per unit of log(size / baseline)

const CHAINS := {
	"Thumb": [["Metacarpal", 1, 2], ["Proximal", 2, 3], ["Distal", 3, 4]],
	"Index": [["Proximal", 5, 6], ["Intermediate", 6, 7], ["Distal", 7, 8]],
	"Middle": [["Proximal", 9, 10], ["Intermediate", 10, 11], ["Distal", 11, 12]],
	"Ring": [["Proximal", 13, 14], ["Intermediate", 14, 15], ["Distal", 15, 16]],
	"Little": [["Proximal", 17, 18], ["Intermediate", 18, 19], ["Distal", 19, 20]],
}
const TIPS := ["Thumb_Tip", "Index_Tip", "Middle_Tip", "Ring_Tip", "Little_Tip"]

var label := "right"
var terrain: Node3D
var cam: Camera3D
var skeleton: Skeleton3D
var material: ShaderMaterial
var fade := 0.0
var dip := 0.0                   # 0 at the tips, 1 sunk deep
var in_grass := 0.0
var lifted := 0.0               # 1 while the hand is a fist
var touches: Array = []

var _side := "R"
var _bone := {}
var _rest_global := {}
var _rest_frame: Basis
var _target := Vector3.ZERO
var _baseline := -1.0
var _seen_for := 0.0
var _last_points := {}
var _placed := false
var _pitch := deg_to_rad(70.0)
var _scale := 4.0
var _near := 1.0


func setup(hand_label: String, terrain_node: Node3D, camera: Camera3D) -> void:
	label = hand_label
	terrain = terrain_node
	cam = camera
	_side = "L" if label == "left" else "R"
	var path := "res://assets/hands/hand_%s.gltf" % _side.to_lower()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var bytes := FileAccess.get_file_as_bytes(path)
	if doc.append_from_buffer(bytes, path.get_base_dir(), state) != OK:
		push_error("could not load " + path)
		return
	var scene := doc.generate_scene(state)
	add_child(scene)
	skeleton = _find_skeleton(scene)
	material = ShaderMaterial.new()
	material.shader = load("res://shaders/ghost_hand.gdshader")
	for mi in _meshes(scene):
		mi.material_override = material
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for b in skeleton.get_bone_count():
		_bone[skeleton.get_bone_name(b)] = b
	for name in _bone:
		_rest_global[name] = skeleton.get_bone_global_rest(_bone[name])
	_rest_frame = _palm_frame(
		_rest_global[_n("Wrist")].origin, _rest_global[_n("Index_Proximal")].origin,
		_rest_global[_n("Middle_Proximal")].origin, _rest_global[_n("Little_Proximal")].origin)
	visible = false


func _n(bone: String) -> String:
	return "%s_%s" % [bone, _side]


## Called every frame with this hand's latest data (empty when absent).
func update_hand(h: Dictionary, delta: float) -> void:
	var present: bool = h.get("present", false) and h.has("world") and h.has("pos")
	fade = move_toward(fade, 1.0 if present else 0.0, delta / 0.3)
	visible = fade > 0.001
	if skeleton == null:
		return
	if not present:
		_seen_for = 0.0
		touches = []
		in_grass = move_toward(in_grass, 0.0, delta * 3.0)
		_apply_material()
		return

	var pos: Vector3 = h.pos
	# depth: the hand's size in the image against where it settled after appearing
	_seen_for += delta
	if _baseline < 0.0 or _seen_for < 0.4:
		_baseline = pos.z if _baseline < 0.0 or _seen_for < delta * 1.5 else lerpf(_baseline, pos.z, 0.2)
	else:
		_baseline = lerpf(_baseline, pos.z, 1.0 - exp(-delta / 30.0))
	var rel := log(max(pos.z, 1e-3) / max(_baseline, 1e-3))
	var want := clampf(rel * DEPTH_GAIN, -0.25, 1.0)
	# a fist lifts the hand up out of the grass: it rests there and touches nothing
	lifted = lerpf(lifted, 1.0 if h.get("gesture", "") == "fist" else 0.0, 1.0 - exp(-delta / 0.15))
	want = lerpf(want, -0.7, lifted)
	dip = lerpf(dip, want, 1.0 - exp(-delta / 0.12))

	var vp := get_viewport().get_visible_rect().size
	var home := 0.5 - GAP_X if label == "left" else 0.5 + GAP_X
	var sx := clampf(0.5 + (pos.x - home) * GAIN_X, -0.05, 1.05)
	var sy := clampf(0.5 + (pos.y - 0.5) * GAIN_Y, -0.05, 1.05)
	var sp := Vector2(sx, sy) * vp
	var hover := GRASS_TOP - dip * DIP_RANGE
	var from := cam.project_ray_origin(sp)
	var dir := cam.project_ray_normal(sp)
	var reach: Vector2 = cam.reach()
	var hit: Variant = terrain.ray_hit(from, dir, reach.y, hover)
	var dist: float = reach.y if hit == null else from.distance_to(hit)
	if hit == null or dist < reach.x or dist > reach.y:
		# off the meadow in this view: hold it at the edge of reach, still sinking with depth
		dist = clampf(dist, reach.x, reach.y)
		_target = from + dir * dist - Vector3.UP * dip * DIP_RANGE
	else:
		_target = hit
	if not _placed:
		global_position = _target
		_placed = true
	global_position = global_position.lerp(_target, 1.0 - exp(-delta / 0.05))
	var view_h := 2.0 * cam.global_position.distance_to(global_position) * tan(deg_to_rad(cam.fov) * 0.5)
	var k := 1.0 - exp(-delta / 0.4)
	_scale = lerpf(_scale, clampf(SCREEN_SHARE * view_h / HAND_LEN, 1.5, 32.0), k)
	_pitch = lerpf(_pitch, cam.hand_pitch(), k)
	_near = lerpf(_near, clampf(pow(SIZE_HOME / max(pos.z, 1e-3), 0.85), NEAR_RANGE.x, NEAR_RANGE.y), 1.0 - exp(-delta / 0.08))
	scale = Vector3.ONE * _scale * _near

	_pose(h.world)
	_collect_touches(delta)
	_apply_material()


func _apply_material() -> void:
	material.set_shader_parameter("body_alpha", 0.45 * fade)
	material.set_shader_parameter("rim_alpha", 0.9 * fade)
	material.set_shader_parameter("glow", 0.35 + in_grass * 0.9)


## MediaPipe world (x right in the mirrored image, y down, z away from the
## webcam) to the meadow, relative to the palm centre, in this node's space.
func _map(world: PackedVector3Array) -> PackedVector3Array:
	var up := Vector3.UP
	var right := cam.global_basis.x
	right.y = 0.0
	right = right.normalized()
	var fwd := up.cross(right)
	var u2 := up * cos(_pitch) + fwd * sin(_pitch)
	var f2 := fwd * cos(_pitch) - up * sin(_pitch)
	var centre := (world[0] + world[5] + world[9] + world[13] + world[17]) / 5.0
	var out := PackedVector3Array()
	out.resize(21)
	for k in 21:
		var p := world[k] - centre
		out[k] = right * p.x - u2 * p.y - f2 * p.z
	return out


func _pose(world: PackedVector3Array) -> void:
	var pts := _map(world)
	# into skeleton space (this node only scales; the skeleton may carry the glTF's own transform)
	var to_skel := skeleton.global_transform.affine_inverse() * global_transform
	var sk := PackedVector3Array()
	sk.resize(21)
	for k in 21:
		sk[k] = to_skel * pts[k]
	var frame := _palm_frame(sk[0], sk[5], sk[9], sk[17])
	var turn := frame * _rest_frame.inverse()

	var globals := {}
	var wrist := _n("Wrist")
	var gw := Transform3D(turn * _rest_global[wrist].basis, sk[0])
	globals[wrist] = gw
	skeleton.set_bone_pose_rotation(_bone[wrist], gw.basis.get_rotation_quaternion())
	skeleton.set_bone_pose_position(_bone[wrist], gw.origin)

	for finger in CHAINS:
		var parent_name := wrist
		if finger != "Thumb":
			# the palm's bones keep their rest place on the wrist
			parent_name = _n(finger + "_Metacarpal")
			globals[parent_name] = gw * skeleton.get_bone_rest(_bone[parent_name])
			_set_local(parent_name, wrist, globals)
		for seg in CHAINS[finger]:
			var name := _n(finger + "_" + seg[0])
			var g: Transform3D = globals[parent_name] * skeleton.get_bone_rest(_bone[name])
			var d: Vector3 = sk[seg[2]] - sk[seg[1]]
			var y := g.basis.y.normalized()
			if d.length() > 1e-6 and y.dot(d.normalized()) > -0.999:
				g.basis = Basis(Quaternion(y, d.normalized())) * g.basis
			globals[name] = g
			_set_local(name, parent_name, globals)
			parent_name = name


func _set_local(name: String, parent_name: String, globals: Dictionary) -> void:
	var local: Transform3D = globals[parent_name].affine_inverse() * globals[name]
	skeleton.set_bone_pose_rotation(_bone[name], local.basis.orthonormalized().get_rotation_quaternion())
	skeleton.set_bone_pose_position(_bone[name], local.origin)


func _palm_frame(wrist: Vector3, index: Vector3, middle: Vector3, little: Vector3) -> Basis:
	var y := (middle - wrist).normalized()
	var x := index - little
	x = (x - y * x.dot(y)).normalized()
	var z := x.cross(y)
	return Basis(x, y, z)


## Fingertips and palm, each a touch for the bend field once it is in the grass.
func _collect_touches(delta: float) -> void:
	touches = []
	var deepest := 0.0
	var pts := {"palm": global_position}
	for tip in TIPS:
		var b: int = _bone.get(_n(tip), -1)
		if b >= 0:
			pts[tip] = skeleton.global_transform * skeleton.get_bone_global_pose(b).origin
	for key in pts:
		var p: Vector3 = pts[key]
		var ground: float = terrain.height_at(p.x, p.z)
		var depth: float = ground + GRASS_TOP - p.y
		var s := clampf(depth / 0.35, 0.0, 1.0)
		deepest = max(deepest, s)
		var vel := Vector2.ZERO
		if _last_points.has(key) and delta > 0.0:
			var lp: Vector3 = _last_points[key]
			vel = Vector2(p.x - lp.x, p.z - lp.z) / delta
		_last_points[key] = p
		if s <= 0.0:
			continue
		var speed := vel.length()
		touches.append({
			"pos": p,
			"radius": (0.6 if key == "palm" else 0.3) * _scale * _near / 4.0,
			"drag": vel / max(speed, 0.001) * clampf(speed / 3.0, 0.0, 1.0),
			"press": clampf(dip, 0.0, 1.0) * s,
			"strength": 0.4 * s * fade * (1.0 - lifted),
		})
	in_grass = lerpf(in_grass, deepest, 1.0 - exp(-delta / 0.1))


func _find_skeleton(n: Node) -> Skeleton3D:
	if n is Skeleton3D:
		return n
	for c in n.get_children():
		var s := _find_skeleton(c)
		if s:
			return s
	return null


func _meshes(n: Node) -> Array:
	var out := []
	if n is MeshInstance3D:
		out.append(n)
	for c in n.get_children():
		out.append_array(_meshes(c))
	return out
