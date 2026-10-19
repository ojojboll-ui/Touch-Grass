extends SubViewport
## Where the grass has been touched, as a texture the grass shader reads.
##
## The viewport never clears: each frame a faint neutral rectangle pulls every
## pixel back toward rest, then the touches are drawn on top. So the blades
## part round the hand, and the wake behind it closes again over a few
## seconds. It renders in HDR so the slow return does not stall on 8-bit
## rounding.

const SIZE_M := 32.0        # metres across, centred on the origin
const RES := 256
const MAX_TOUCHES := 12

@export var recover_seconds := 2.6

var _decay: ColorRect
var _stamps: Array[ColorRect] = []
var _first := true


func _init() -> void:
	size = Vector2i(RES, RES)
	use_hdr_2d = true
	transparent_bg = false
	disable_3d = true
	render_target_update_mode = SubViewport.UPDATE_ALWAYS
	render_target_clear_mode = SubViewport.CLEAR_MODE_NEVER


func _ready() -> void:
	_decay = ColorRect.new()
	_decay.size = Vector2(RES, RES)
	var dm := ShaderMaterial.new()
	dm.shader = load("res://shaders/bend_decay.gdshader")
	_decay.material = dm
	add_child(_decay)
	var shader: Shader = load("res://shaders/bend_stamp.gdshader")
	for k in MAX_TOUCHES:
		var r := ColorRect.new()
		var m := ShaderMaterial.new()
		m.shader = shader
		r.material = m
		r.visible = false
		add_child(r)
		_stamps.append(r)


func _process(delta: float) -> void:
	if _first:
		_first = false
		return
	(_decay.material as ShaderMaterial).set_shader_parameter("amount", 1.0 - exp(-delta / recover_seconds))


## touches: Array of {pos: Vector3, radius: float, drag: Vector2, press: float, strength: float}
func set_touches(touches: Array) -> void:
	for k in MAX_TOUCHES:
		var r := _stamps[k]
		if k >= touches.size():
			r.visible = false
			continue
		var t: Dictionary = touches[k]
		var p: Vector3 = t.pos
		var px := Vector2((p.x / SIZE_M + 0.5) * RES, (p.z / SIZE_M + 0.5) * RES)
		var rad: float = t.radius / SIZE_M * RES
		r.position = px - Vector2(rad, rad)
		r.size = Vector2(rad, rad) * 2.0
		r.visible = true
		var m: ShaderMaterial = r.material
		m.set_shader_parameter("drag", t.get("drag", Vector2.ZERO))
		m.set_shader_parameter("press", t.get("press", 0.0))
		m.set_shader_parameter("strength", t.get("strength", 0.5))
