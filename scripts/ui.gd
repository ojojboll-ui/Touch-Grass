extends CanvasLayer
## A small, quiet panel in the lower right: the camera view and the hour.
## H hides it, C steps the camera, 1-4 jump to a view.

var cam: Camera3D
var tod: Node3D
var panel: PanelContainer
var cam_button: Button
var hour_slider: HSlider
var hour_label: Label


func build(camera: Camera3D, time_of_day: Node3D) -> void:
	cam = camera
	tod = time_of_day

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.07, 0.05, 0.38)
	style.set_corner_radius_all(14)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 10
	style.content_margin_bottom = 10

	panel = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", style)
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.anchor_top = 1.0
	panel.anchor_bottom = 1.0
	panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	panel.offset_right = -20
	panel.offset_bottom = -20
	add_child(panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	panel.add_child(box)

	cam_button = Button.new()
	cam_button.flat = true
	cam_button.focus_mode = Control.FOCUS_NONE
	cam_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	cam_button.add_theme_color_override("font_color", Color(1, 1, 1, 0.85))
	cam_button.add_theme_color_override("font_hover_color", Color(1, 1, 1, 1))
	cam_button.pressed.connect(func(): cam.next())
	box.add_child(cam_button)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	box.add_child(row)
	hour_label = Label.new()
	hour_label.custom_minimum_size.x = 92
	hour_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.85))
	row.add_child(hour_label)
	hour_slider = HSlider.new()
	hour_slider.min_value = 0.0
	hour_slider.max_value = 24.0
	hour_slider.step = 0.05
	hour_slider.custom_minimum_size.x = 220
	hour_slider.focus_mode = Control.FOCUS_NONE
	hour_slider.value = tod.hour
	hour_slider.value_changed.connect(func(v): tod.hour = v)
	row.add_child(hour_slider)

	cam.view_changed.connect(func(_i, _t): _refresh())
	tod.changed.connect(func(_h): _refresh())
	_refresh()


func _refresh() -> void:
	cam_button.text = "Kamera:  %s" % cam.title()
	var h := int(tod.hour)
	var m := int(round((tod.hour - h) * 60.0)) % 60
	hour_label.text = "Tid  %02d:%02d" % [h, m]
	if not is_equal_approx(hour_slider.value, tod.hour):
		hour_slider.set_value_no_signal(tod.hour)


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo:
		return
	match k.keycode:
		KEY_H:
			panel.visible = not panel.visible
		KEY_C:
			cam.next()
		KEY_1, KEY_2, KEY_3, KEY_4:
			cam.go_to(k.keycode - KEY_1)
		KEY_F:
			var w := get_window()
			w.mode = Window.MODE_WINDOWED if w.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
