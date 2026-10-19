extends Control
## The chord wheel: a small translucent ring in the lower left corner, the
## twelve roots round it in the circle of fifths with C at the top. Drawn flat
## over the picture (the flowers in the grass read as silly, 2026-10-19).
##
## The left hand's place round the ring picks the root; its extended fingers
## pick the kind, as the Omnichord's three rows of buttons: one finger major,
## two minor, three seventh, an open hand major. A fist keeps the chord. Inside
## the middle of the ring nothing changes, so the hand can rest there.

signal chord_changed(root: int, quality: int, name: String)

const CENTER := Vector2(0.14, 0.76)    # screen position of the middle (x of width, y of height)
const RADIUS := 0.13                    # of the picture's height
const DEAD := 0.35                      # share of the radius that changes nothing
const ROOTS := [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]    # clockwise from the top: C G D A E B Gb Db Ab Eb Bb F
const NAMES := ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
const SUFFIX := ["", "m", "7"]
const COLORS := [Color(1.0, 0.80, 0.22), Color(0.66, 0.56, 1.0), Color(1.0, 0.36, 0.24)]

var synth: Object
var sector := 0
var quality := 0
var _hand := Vector2(-1, -1)
var _active := false
var _glow := 0.0
var _pending_q := 0
var _pending_for := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func update(hand_pos: Vector2, present: bool, fingers: int, fist: bool, delta: float) -> void:
	_active = present and not fist
	_hand = hand_pos if present else Vector2(-1, -1)
	if _active:
		var vp := get_viewport_rect().size
		var d := Vector2((hand_pos.x - CENTER.x) * vp.x / vp.y, hand_pos.y - CENTER.y)
		if d.length() > RADIUS * DEAD:
			var a := fposmod(atan2(d.x, -d.y), TAU)
			var s := int(round(a / (TAU / 12.0))) % 12
			# hysteresis: stay on the current root until well past halfway to the next
			var off := absf(wrapf(a - TAU * sector / 12.0, -PI, PI))
			if s != sector and off > TAU / 12.0 * 0.62:
				sector = s
				_send()
		var q := 1 if fingers == 2 else (2 if fingers == 3 else 0)
		# a finger count must hold a moment, or passing two fingers on the way to three flickers minor
		if q != _pending_q:
			_pending_q = q
			_pending_for = 0.0
		_pending_for += delta
		if _pending_q != quality and _pending_for > 0.15:
			quality = _pending_q
			_send()
	_glow = move_toward(_glow, 0.0, delta * 2.0)
	queue_redraw()


func current_name() -> String:
	return NAMES[ROOTS[sector]] + SUFFIX[quality]


func _send() -> void:
	if synth:
		synth.set_chord(ROOTS[sector], quality)
	_glow = 1.0
	chord_changed.emit(ROOTS[sector], quality, current_name())


func _draw() -> void:
	var vp := get_viewport_rect().size
	var c := CENTER * vp
	var r := RADIUS * vp.y
	var dim := 1.0 if _active else 0.6
	var font := get_theme_default_font()
	var fsize := int(clampf(r * 0.2, 11.0, 22.0))
	# the ring itself, faint
	draw_arc(c, r, 0.0, TAU, 96, Color(1, 1, 1, 0.22 * dim), r * 0.42, true)
	draw_arc(c, r * DEAD, 0.0, TAU, 48, Color(1, 1, 1, 0.10 * dim), 1.5, true)
	var step := TAU / 12.0
	for k in 12:
		var a := TAU * k / 12.0
		var dir := Vector2(sin(a), -cos(a))
		var sel := k == sector
		if sel:
			var col: Color = COLORS[quality]
			col.a = (0.55 + 0.35 * _glow) * dim
			# the chosen root's segment, lit in its kind's colour
			draw_arc(c, r, a - PI / 2.0 - step / 2.0 + 0.03, a - PI / 2.0 + step / 2.0 - 0.03, 24, col, r * 0.42, true)
		var text: String = NAMES[ROOTS[k]] + (SUFFIX[quality] if sel else "")
		var size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, fsize)
		var at := c + dir * r - Vector2(size.x / 2.0, -size.y / 3.0)
		var tc := Color(1, 1, 1, (0.95 if sel else 0.6) * dim)
		draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fsize, 4, Color(0.05, 0.12, 0.03, 0.5 * dim))
		draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fsize, tc)
	# where the left hand is, when it is near the ring
	if _hand.x >= 0.0:
		var hp := _hand * vp
		if hp.distance_to(c) < r * 2.2:
			draw_circle(hp, 5.0, Color(1, 1, 0.9, 0.7 if _active else 0.3))
