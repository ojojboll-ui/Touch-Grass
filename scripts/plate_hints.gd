extends Control
## The plates are invisible; only while a hand plays on one does its chord's
## name show, faintly, at the left edge of the picture, fading out again
## a moment after the last pluck.

const StrumPlate := preload("res://scripts/strum_plate.gd")

var strums := {}
var _alpha := PackedFloat32Array()


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_alpha.resize(StrumPlate.count())


func _process(delta: float) -> void:
	for k in _alpha.size():
		var want := 0.0
		for who in strums:
			var sp: Node = strums[who]
			if sp.plate == k:
				want = maxf(want, 0.25 + 0.6 * sp.sounding())
		_alpha[k] = move_toward(_alpha[k], want, delta * (3.0 if want > _alpha[k] else 0.8))
	queue_redraw()


func _draw() -> void:
	var vp := get_viewport_rect().size
	var font := get_theme_default_font()
	var size := int(clampf(vp.y * 0.03, 14.0, 30.0))
	var n := _alpha.size()
	for k in n:
		if _alpha[k] <= 0.01:
			continue
		var y := (k + 0.5) / n * vp.y + size * 0.35
		var col: Color = StrumPlate.COLORS[k].lerp(Color.WHITE, 0.5)
		col.a = _alpha[k]
		var text := StrumPlate.plate_name(k)
		draw_string_outline(font, Vector2(22, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 5, Color(0.05, 0.1, 0.03, _alpha[k] * 0.5))
		draw_string(font, Vector2(22, y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
