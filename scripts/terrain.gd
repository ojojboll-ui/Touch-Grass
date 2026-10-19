extends Node3D
## The ground: a height image shared by the ground mesh, the grass shader and
## the CPU (for putting the hand on the grass). The meadow in the middle is
## nearly flat so the strings lie evenly; hills rise round it on every side.

const SIZE := 400.0          # metres across
const RES := 512             # height image pixels across

var heights: Image
var height_tex: ImageTexture
var mesh_instance: MeshInstance3D
var material: ShaderMaterial

var _noise_hills := FastNoiseLite.new()
var _noise_meadow := FastNoiseLite.new()


func build() -> void:
	_noise_hills.seed = 11
	_noise_hills.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise_hills.frequency = 0.009
	_noise_hills.fractal_octaves = 4
	_noise_meadow.seed = 5
	_noise_meadow.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise_meadow.frequency = 0.035
	_noise_meadow.fractal_octaves = 2

	heights = Image.create_empty(RES, RES, false, Image.FORMAT_RF)
	for j in RES:
		var z := (float(j) / (RES - 1) - 0.5) * SIZE
		for i in RES:
			var x := (float(i) / (RES - 1) - 0.5) * SIZE
			heights.set_pixel(i, j, Color(_height(x, z), 0, 0))
	height_tex = ImageTexture.create_from_image(heights)

	material = ShaderMaterial.new()
	material.shader = load("res://shaders/ground.gdshader")
	material.set_shader_parameter("height_tex", height_tex)
	material.set_shader_parameter("terrain_size", SIZE)

	var plane := PlaneMesh.new()
	plane.size = Vector2(SIZE, SIZE)
	plane.subdivide_width = 300
	plane.subdivide_depth = 300
	mesh_instance = MeshInstance3D.new()
	mesh_instance.mesh = plane
	mesh_instance.material_override = material
	mesh_instance.custom_aabb = AABB(Vector3(-SIZE / 2, -20, -SIZE / 2), Vector3(SIZE, 80, SIZE))
	add_child(mesh_instance)


func _height(x: float, z: float) -> float:
	var r := sqrt(x * x + z * z)
	var meadow := _noise_meadow.get_noise_2d(x, z) * 0.45
	var hills := (_noise_hills.get_noise_2d(x, z) * 0.5 + 0.5) * 26.0 * smoothstep(18.0, 120.0, r)
	var bowl := pow(smoothstep(25.0, 190.0, r), 1.6) * 18.0
	return meadow + hills + bowl


## Bilinear height at a world point, the same the shaders read.
func height_at(x: float, z: float) -> float:
	var fx: float = clamp((x / SIZE + 0.5) * (RES - 1), 0.0, RES - 1.001)
	var fz: float = clamp((z / SIZE + 0.5) * (RES - 1), 0.0, RES - 1.001)
	var i := int(fx)
	var j := int(fz)
	var u := fx - i
	var v := fz - j
	var a := heights.get_pixel(i, j).r
	var b := heights.get_pixel(i + 1, j).r
	var c := heights.get_pixel(i, j + 1).r
	var d := heights.get_pixel(i + 1, j + 1).r
	return lerpf(lerpf(a, b, u), lerpf(c, d, u), v)


## March a ray until it passes under the ground, or under `lift` metres above
## it. Returns null if it never does.
func ray_hit(from: Vector3, dir: Vector3, max_dist := 300.0, lift := 0.0) -> Variant:
	var step := 0.5
	var prev := from
	var t := 0.0
	while t < max_dist:
		t += step
		var p := from + dir * t
		if p.y < height_at(p.x, p.z) + lift:
			# refine between prev and p
			var lo := prev
			var hi := p
			for k in 12:
				var m := (lo + hi) * 0.5
				if m.y < height_at(m.x, m.z) + lift:
					hi = m
				else:
					lo = m
			return (lo + hi) * 0.5
		prev = p
		step = min(step * 1.05, 3.0)
	return null
