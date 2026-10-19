extends Node3D
## The field of blades: a grid of tiles, each a MultiMeshInstance3D pointing at
## one of three shared MultiMeshes. The shader places every blade, so a tile
## changes level of detail by swapping its multimesh and material, nothing
## else. Levels are picked by distance to the camera, so every camera view
## gets its dense blades in front of it.

const TILE := 5.0
const EXTENT := 95.0              # tiles cover -EXTENT..EXTENT on x and z
# per_side blades along a tile edge, blade segments, reach in metres
const LODS := [
	{"per_side": 90, "segments": 6, "reach": 15.5},
	{"per_side": 56, "segments": 4, "reach": 25.5},
	{"per_side": 30, "segments": 2, "reach": 40.0},
	{"per_side": 12, "segments": 1, "reach": 80.0},
]

var materials: Array[ShaderMaterial] = []
var multimeshes: Array[MultiMesh] = []
var tiles: Array[MultiMeshInstance3D] = []
var _tile_lod: PackedInt32Array
var _last_cam := Vector2(INF, INF)


func build(terrain: Node3D, gust_tex: Texture2D, bend_tex: Texture2D, bend_size: float) -> void:
	var shader: Shader = load("res://shaders/grass.gdshader")
	for lod in LODS:
		var n: int = lod.per_side
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = _blade_mesh(lod.segments)
		mm.instance_count = n * n
		var buf := PackedFloat32Array()
		buf.resize(n * n * 12)
		for k in n * n:
			buf[k * 12 + 0] = 1.0
			buf[k * 12 + 5] = 1.0
			buf[k * 12 + 10] = 1.0
		mm.buffer = buf
		multimeshes.append(mm)

		var mat := ShaderMaterial.new()
		mat.shader = shader
		mat.set_shader_parameter("height_tex", terrain.height_tex)
		mat.set_shader_parameter("terrain_size", terrain.SIZE)
		mat.set_shader_parameter("gust_tex", gust_tex)
		mat.set_shader_parameter("bend_tex", bend_tex)
		mat.set_shader_parameter("bend_size", bend_size)
		mat.set_shader_parameter("tile_size", TILE)
		mat.set_shader_parameter("per_side", float(n))
		mat.set_shader_parameter("max_density", float(n * n) / (TILE * TILE))
		materials.append(mat)

	var count := int(EXTENT * 2.0 / TILE)
	for j in count:
		for i in count:
			var mi := MultiMeshInstance3D.new()
			mi.position = Vector3(-EXTENT + i * TILE, 0.0, -EXTENT + j * TILE)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			var y0 := _tile_low(terrain, mi.position)
			mi.custom_aabb = AABB(Vector3(-1.5, y0 - 1.0, -1.5), Vector3(TILE + 3.0, 6.0 + _tile_high(terrain, mi.position) - y0, TILE + 3.0))
			mi.visible = false
			add_child(mi)
			tiles.append(mi)
	_tile_lod.resize(tiles.size())
	_tile_lod.fill(-1)


func _tile_low(terrain: Node3D, p: Vector3) -> float:
	var lo := INF
	for c in [Vector2(0, 0), Vector2(TILE, 0), Vector2(0, TILE), Vector2(TILE, TILE), Vector2(TILE / 2, TILE / 2)]:
		lo = min(lo, terrain.height_at(p.x + c.x, p.z + c.y))
	return lo


func _tile_high(terrain: Node3D, p: Vector3) -> float:
	var hi := -INF
	for c in [Vector2(0, 0), Vector2(TILE, 0), Vector2(0, TILE), Vector2(TILE, TILE), Vector2(TILE / 2, TILE / 2)]:
		hi = max(hi, terrain.height_at(p.x + c.x, p.z + c.y))
	return hi


## Pick each tile's level from the ground point the view is centred on, so
## the dense blades are where the player looks however high the camera is.
func follow_camera(cam_pos: Vector3) -> void:
	var c := Vector2(cam_pos.x, cam_pos.z)
	for m in materials:
		m.set_shader_parameter("cam_xz", c)
	if c.distance_to(_last_cam) < 0.75:
		return
	_last_cam = c
	for k in tiles.size():
		var mi := tiles[k]
		var center := Vector2(mi.position.x + TILE / 2, mi.position.z + TILE / 2)
		var d: float = max(center.distance_to(c) - TILE * 0.71, 0.0)
		var lod := -1
		for l in LODS.size():
			if d < LODS[l].reach:
				lod = l
				break
		if lod == _tile_lod[k]:
			continue
		_tile_lod[k] = lod
		mi.visible = lod >= 0
		if lod >= 0:
			mi.multimesh = multimeshes[lod]
			mi.material_override = materials[lod]


func set_param(name: String, value: Variant) -> void:
	for m in materials:
		m.set_shader_parameter(name, value)


## A strip from root (y = 0) to a point at the tip (y = 1), x = -0.5..0.5 across.
func _blade_mesh(segments: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for k in segments:
		var t := float(k) / segments
		verts.append(Vector3(-0.5, t, 0.0))
		verts.append(Vector3(0.5, t, 0.0))
		uvs.append(Vector2(0.0, t))
		uvs.append(Vector2(1.0, t))
	verts.append(Vector3(0.0, 1.0, 0.0))
	uvs.append(Vector2(0.5, 1.0))
	for k in segments - 1:
		var a := k * 2
		idx.append_array([a, a + 2, a + 1, a + 1, a + 2, a + 3])
	var last := (segments - 1) * 2
	idx.append_array([last, segments * 2, last + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3(0, 0, 1))
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m
