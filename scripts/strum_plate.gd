extends Node
## The hidden strum plate: the Omnichord's 13 strings standing across the
## picture, left to right, played by the right hand's place on screen.
##
## The strings are in screen space, not on the ground, so they sit under the
## hand the same way in every camera view. Each frame the hand's position on
## the plate is a continuous string coordinate; every whole string it passed
## since the last frame is plucked, delayed by how far into the frame the
## crossing fell, so a sweep sounds as even as the hand moved.
##
## A string that was just plucked is disarmed until the hand has moved a third
## of a string away from it, so a hand resting on a string does not buzz it.

signal plucked(string_index: int, velocity: float)

const LEFT := 0.10           # screen x of the lowest-positioned string
const RIGHT := 0.94          # and the last
const REARM := 0.33          # strings of travel before a string can sound again

var synth: Object
var _prev := -1.0            # string coordinate last frame, -1 when not playing
var _armed := PackedByteArray()
var _speed := 0.0            # strings per second, smoothed


func _ready() -> void:
	_armed.resize(16)
	_armed.fill(1)


func count() -> int:
	return synth.get_string_count() if synth else 13


## Screen x of string k, for drawing.
func string_x(k: int) -> float:
	return lerpf(LEFT, RIGHT, float(k) / float(count() - 1))


## playing: the hand is over the plate and allowed to sound (present, not a fist).
## depth: 0..1, how far it has sunk into the grass; louder deeper.
func update(screen_x: float, playing: bool, depth: float, delta: float) -> void:
	var n := count()
	if not playing or synth == null:
		_prev = -1.0
		_speed = 0.0
		return
	var s := (screen_x - LEFT) / (RIGHT - LEFT) * float(n - 1)
	if _prev < 0.0:
		_prev = s
		return
	var moved := s - _prev
	_speed = lerpf(_speed, abs(moved) / max(delta, 1e-4), 0.25)
	var lo := mini(int(ceil(min(_prev, s))), n)
	var hi := maxi(int(floor(max(_prev, s))), -1)
	if abs(moved) > 1e-5:
		var order := range(max(lo, 0), min(hi, n - 1) + 1)
		if moved < 0.0:
			order.reverse()
		for k in order:
			# only strings actually crossed this frame, not one the hand started on
			if is_equal_approx(float(k), _prev):
				continue
			if _armed[k] == 0:
				continue
			var frac: float = clampf((float(k) - _prev) / moved, 0.0, 1.0)
			var vel := clampf(0.35 + 0.35 * clampf(_speed / 20.0, 0.0, 1.0) + 0.3 * depth, 0.15, 1.0)
			synth.pluck(k, vel, frac * delta)
			_armed[k] = 0
			plucked.emit(k, vel)
	for k in n:
		if _armed[k] == 0 and abs(s - float(k)) > REARM:
			_armed[k] = 1
	_prev = s
