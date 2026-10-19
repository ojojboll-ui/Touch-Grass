extends Node
## The hands as handtrack sees them, read from OSC on UDP 9000.
##
## On start it listens for a second; if no handtrack is already sending, it
## starts one from ../handtrack's venv without a preview window and stops it
## again on exit. Each hand ("left" / "right", as the user sees their own
## hands) keeps its latest values; a hand not heard from for 0.4 s is gone.

const PORT := 9000
const HANDTRACK_DIR := "../handtrack"
const STALE := 0.4

var udp := PacketPeerUDP.new()
var hands := {}          # label -> Dictionary
var status := "startar"
var _pid := -1
var _alive_at := -1000.0
var _started_at := 0.0
var _tried_launch := false
var _bound := false


func _ready() -> void:
	_started_at = _now()
	var err := udp.bind(PORT, "127.0.0.1")
	_bound = err == OK
	if not _bound:
		status = "port %d upptagen (kör Chordtroller eller Handsynt?)" % PORT


func _exit_tree() -> void:
	_stop_handtrack()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		_stop_handtrack()


## The venv's python.exe is only a launcher that starts the real interpreter
## as its child, so killing our pid alone left the tracker running with the
## webcam held. Kill the whole tree. handtrack also watches for us (--exit-with)
## in case Godot is stopped without this running, as the editor's stop button does.
func _stop_handtrack() -> void:
	if _pid > 0:
		OS.execute("taskkill", ["/PID", str(_pid), "/T", "/F"])
		_pid = -1


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _process(_delta: float) -> void:
	if not _bound:
		return
	while udp.get_available_packet_count() > 0:
		_handle(udp.get_packet())
	var t := _now()
	if not _tried_launch and t - _started_at > 1.0 and t - _alive_at > 1.0:
		_tried_launch = true
		_launch()
	for label in hands.keys():
		var h: Dictionary = hands[label]
		h.present = h.get("present", false) and t - h.get("t", -100.0) < STALE
	if t - _alive_at < 1.5:
		var n := present_hands().size()
		status = "inga händer i bild" if n == 0 else ("en hand" if n == 1 else "två händer")
	elif _pid > 0:
		status = "startar kameran…"


func present_hands() -> Array:
	var out := []
	for label in hands:
		if hands[label].present and hands[label].has("world"):
			out.append(label)
	return out


func hand(label: String) -> Dictionary:
	return hands.get(label, {})


func _launch() -> void:
	var dir := ProjectSettings.globalize_path("res://").path_join(HANDTRACK_DIR).simplify_path()
	var py := dir.path_join(".venv/Scripts/python.exe")
	if not FileAccess.file_exists(py):
		status = "hittar inte handtrack (%s)" % py
		return
	var code := "import sys, runpy; sys.path.insert(0, r'%s'); sys.argv = ['handtrack', '--osc', '127.0.0.1:%d', '--osc-world', '--no-preview', '--exit-with', '%d']; runpy.run_module('handtrack', run_name='__main__')" % [dir, PORT, OS.get_process_id()]
	_pid = OS.create_process(py, ["-c", code])
	status = "startar kameran…" if _pid > 0 else "kunde inte starta handtrack"


# --- OSC -------------------------------------------------------------------

func _handle(packet: PackedByteArray) -> void:
	var buf := StreamPeerBuffer.new()
	buf.data_array = packet
	buf.big_endian = true
	var address := _read_string(buf)
	if address == "#bundle":
		buf.get_64()   # time tag
		while buf.get_position() < packet.size():
			var size := buf.get_32()
			_handle(packet.slice(buf.get_position(), buf.get_position() + size))
			buf.seek(buf.get_position() + size)
		return
	var tags := _read_string(buf)
	var args := []
	for c in tags.substr(1):
		match c:
			"f": args.append(buf.get_float())
			"i": args.append(buf.get_32())
			"s": args.append(_read_string(buf))
			"T": args.append(true)
			"F": args.append(false)
	_dispatch(address, args)


func _read_string(buf: StreamPeerBuffer) -> String:
	var start := buf.get_position()
	var data := buf.data_array
	var end := start
	while end < data.size() and data[end] != 0:
		end += 1
	var s := data.slice(start, end).get_string_from_utf8()
	buf.seek(min((end + 4) & ~3, data.size()))
	return s


func _dispatch(address: String, args: Array) -> void:
	if address == "/hands/alive":
		_alive_at = _now()
		return
	var parts := address.split("/", false)
	if parts.size() != 3 or parts[0] != "hand":
		return
	var label := parts[1]
	if not hands.has(label):
		hands[label] = {"present": false}
	var h: Dictionary = hands[label]
	_alive_at = _now()
	match parts[2]:
		"present":
			h.present = int(args[0]) != 0
		"pos":
			h.pos = Vector3(args[0], args[1], args[2])
			h.present = true
			h.t = _now()
		"open":
			h.open = float(args[0])
		"pinch":
			h.pinch = float(args[0])
		"curl":
			h.curl = PackedFloat32Array(args)
		"gesture":
			h.gesture = String(args[0])
		"world":
			if args.size() >= 63:
				var pts := PackedVector3Array()
				pts.resize(21)
				for k in 21:
					pts[k] = Vector3(args[k * 3], args[k * 3 + 1], args[k * 3 + 2])
				h.world = pts
