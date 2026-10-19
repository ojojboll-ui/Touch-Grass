#include "grass_synth.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

static void initialize_touchgrass_audio (ModuleInitializationLevel level)
{
    if (level != MODULE_INITIALIZATION_LEVEL_SCENE)
        return;

    GDREGISTER_CLASS (GrassSynth);
    GDREGISTER_CLASS (GrassSynthPlayback);
}

static void uninitialize_touchgrass_audio (ModuleInitializationLevel) {}

extern "C"
{
GDExtensionBool GDE_EXPORT touchgrass_audio_init (GDExtensionInterfaceGetProcAddress get_proc_address,
                                                  GDExtensionClassLibraryPtr library,
                                                  GDExtensionInitialization* initialization)
{
    GDExtensionBinding::InitObject init (get_proc_address, library, initialization);
    init.register_initializer (initialize_touchgrass_audio);
    init.register_terminator (uninitialize_touchgrass_audio);
    init.set_minimum_library_initialization_level (MODULE_INITIALIZATION_LEVEL_SCENE);
    return init.init();
}
}
