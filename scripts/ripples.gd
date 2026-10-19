extends Node
## The rings plucked strings send through the grass. Keeps the newest sixteen,
## ages them, and hands them to the grass shader every frame (it does the
## bending and the light; see grass.gdshader).

const MAX := 16
const LIFE := 4.0

var grass: Node3D
var _rings: Array = []          # {pos: Vector3, age: float, strength: float, color: Color}


func add(at: Vector3, strength: float, color: Color) -> void:
	_rings.append({"pos": at, "age": 0.0, "strength": strength, "color": color})
	if _rings.size() > MAX:
		_rings.pop_front()


func _process(delta: float) -> void:
	var data := PackedVector4Array()
	var colors := PackedVector4Array()
	data.resize(MAX)
	colors.resize(MAX)
	var keep := []
	for r in _rings:
		r.age += delta
		if r.age < LIFE:
			keep.append(r)
	_rings = keep
	for k in _rings.size():
		var r: Dictionary = _rings[k]
		data[k] = Vector4(r.pos.x, r.pos.z, r.age, r.strength)
		var c: Color = r.color
		colors[k] = Vector4(c.r, c.g, c.b, 1.0)
	grass.set_param("ripples", data)
	grass.set_param("ripple_colors", colors)
