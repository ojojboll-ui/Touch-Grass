cmake_minimum_required(VERSION 3.17)
project(touchgrass_audio LANGUAGES CXX)

# The extension is built as template_debug: the editor and a project run from
# it load the debug library, which is all Touch Grass needs for now.
set(GODOTCPP_TARGET "template_debug" CACHE STRING "" FORCE)
add_subdirectory(godot-cpp)

add_library(touchgrass_audio SHARED
    src/register_types.cpp
    src/grass_synth.cpp
)
target_link_libraries(touchgrass_audio PRIVATE godot-cpp)
get_target_property(GODOTCPP_SUFFIX godot-cpp GODOTCPP_SUFFIX)

set(OUT "${CMAKE_CURRENT_SOURCE_DIR}/../bin/")
set_target_properties(touchgrass_audio PROPERTIES
    CXX_STANDARD 17
    CXX_EXTENSIONS OFF
    LIBRARY_OUTPUT_DIRECTORY "$<1:${OUT}>"
    RUNTIME_OUTPUT_DIRECTORY "$<1:${OUT}>"
    PDB_OUTPUT_DIRECTORY "$<1:${OUT}>"
    OUTPUT_NAME "touchgrass_audio${GODOTCPP_SUFFIX}"
)
if(MSVC)
    # godot-cpp headers warn about float conversions at /W3; ours are clean
    target_compile_options(touchgrass_audio PRIVATE /fp:precise /W3 /wd4244 /wd4267)
endif()
