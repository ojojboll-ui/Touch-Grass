extends Camera3D
## Fixed camera views, glided between. Each view also breathes: a very slow
## drift of a few centimetres so the picture is never quite still.

signal view_changed(index: int, title: String)

## All views look down on the meadow: in play the top view worked best and the
## one down among the blades did not work at all (2026-10-19). They differ in
## how steeply and from which side. Heights are above the ground below.
const VIEWS := [
	{"title": "Ovanifrån", "pos": Vector3(0.5, 14.0, 3.0), "look": Vector3(0.0, 0.0, -1.0), "fov": 50.0, "pitch": 85.0},
	{"title": "Snett ovanifrån", "pos": Vector3(3.5, 11.0, 4.5), "look": Vector3(-0.5, 0.0, -1.0), "fov": 52.0, "pitch": 78.0},
	{"title": "Diagonalt", "pos": Vector3(7.0, 11.5, 7.0), "look": Vector3(-1.0, 0.0, -1.0), "fov": 52.0, "pitch": 72.0},
	{"title": "Kullen", "pos": Vector3(-11.0, 17.0, 14.0), "look": Vector3(1.0, 0.0, -2.0), "fov": 55.0, "pitch": 68.0},
]
const GLIDE_SECONDS := 3.0

var terrain: Node3D
var index := 0
var _from := {}
var _to := {}
var _t := 1.0
var _time := 0.0
var _focus := Vector3.ZERO


func _ready() -> void:
	_to = _resolved(VIEWS[0])
	_from = _to
	_focus = _to.look
	_place(_to)


## Heights in VIEWS are above the ground under the camera and under the look point.
func _resolved(v: Dictionary) -> Dictionary:
	var p: Vector3 = v.pos
	var l: Vector3 = v.look
	if terrain:
		p.y += terrain.height_at(p.x, p.z)
		l.y += terrain.height_at(l.x, l.z)
	return {"pos": p, "look": l, "fov": v.fov}


func go_to(i: int, instant := false) -> void:
	index = posmod(i, VIEWS.size())
	_from = _current()
	_to = _resolved(VIEWS[index])
	_t = 1.0 if instant else 0.0
	if instant:
		_place(_to)
	view_changed.emit(index, VIEWS[index].title)


func next() -> void:
	go_to(index + 1)


## How far along a ray from the camera a hand may be placed: round the
## distance to the ground in the middle of the picture.
func reach() -> Vector2:
	var d := global_position.distance_to(focus())
	return Vector2(d * 0.55, d * 1.6)


## The ground point the view is centred on, gliding with the camera.
func focus() -> Vector3:
	return _focus


## How far an upright hand is tipped forward in this view: flat from above,
## nearly upright down among the blades.
func hand_pitch() -> float:
	return deg_to_rad(VIEWS[index].pitch)


func title() -> String:
	return VIEWS[index].title


func _current() -> Dictionary:
	return {"pos": global_position, "look": global_position - global_basis.z * 10.0, "fov": fov}


func _process(delta: float) -> void:
	_time += delta
	if _t < 1.0:
		_t = min(_t + delta / GLIDE_SECONDS, 1.0)
	var e := _t * _t * (3.0 - 2.0 * _t)
	var pos: Vector3 = _from.pos.lerp(_to.pos, e)
	var look: Vector3 = _from.look.lerp(_to.look, e)
	_focus = look
	# arc a little upward mid-glide so a move between low and high views does not skim the grass
	pos.y += sin(e * PI) * 0.15 * _from.pos.distance_to(_to.pos)
	var breath := Vector3(sin(_time * 0.21), sin(_time * 0.17 + 1.3) * 0.6, cos(_time * 0.13)) * 0.06
	_place({"pos": pos + breath, "look": look, "fov": lerpf(_from.fov, _to.fov, e)})


func _place(v: Dictionary) -> void:
	fov = v.fov
	look_at_from_position(v.pos, v.look, Vector3.UP)


func gliding() -> bool:
	return _t < 1.0
