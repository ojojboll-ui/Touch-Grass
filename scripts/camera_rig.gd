extends Camera3D
## Fixed camera views, glided between. Each view also breathes: a very slow
## drift of a few centimetres so the picture is never quite still.

signal view_changed(index: int, title: String)

const VIEWS := [
	{"title": "Snett över fältet", "pos": Vector3(7.0, 5.2, 8.5), "look": Vector3(-0.5, 0.2, -2.0), "fov": 52.0},
	{"title": "Bland stråna", "pos": Vector3(1.5, 0.75, 7.5), "look": Vector3(-1.0, 0.9, -4.0), "fov": 58.0},
	{"title": "Kullen", "pos": Vector3(-16.0, 7.5, 20.0), "look": Vector3(2.0, 1.0, -14.0), "fov": 55.0},
	{"title": "Ovanifrån", "pos": Vector3(0.5, 14.0, 4.0), "look": Vector3(0.0, 0.0, -1.0), "fov": 50.0},
]
const GLIDE_SECONDS := 3.0

var terrain: Node3D
var index := 0
var _from := {}
var _to := {}
var _t := 1.0
var _time := 0.0


func _ready() -> void:
	_to = _resolved(VIEWS[0])
	_from = _to
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
	# arc a little upward mid-glide so a move between low and high views does not skim the grass
	pos.y += sin(e * PI) * 0.15 * _from.pos.distance_to(_to.pos)
	var breath := Vector3(sin(_time * 0.21), sin(_time * 0.17 + 1.3) * 0.6, cos(_time * 0.13)) * 0.06
	_place({"pos": pos + breath, "look": look, "fov": lerpf(_from.fov, _to.fov, e)})


func _place(v: Dictionary) -> void:
	fov = v.fov
	look_at_from_position(v.pos, v.look, Vector3.UP)
