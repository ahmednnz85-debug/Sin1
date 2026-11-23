import bpy,sys
bpy.ops.wm.open_mainfile(filepath=sys.argv[-2])
NEW=['Axe_CombatIdle','Attack_Right','Attack_Left','Finisher_Heavy','Finisher_Jump']
arm=bpy.data.objects['Armature']
for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
for a in list(bpy.data.actions):
    if a.name not in NEW: bpy.data.actions.remove(a)
for n in NEW:
    tr=arm.animation_data.nla_tracks.new(); tr.name=n; st=tr.strips.new(n,0,bpy.data.actions[n]); 
arm.animation_data.action=None
bpy.context.scene.render.fps=48
bpy.ops.export_scene.gltf(filepath=sys.argv[-1],export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',
  export_force_sampling=True,export_optimize_animation_size=False,export_frame_step=1,export_morph=False,export_materials='NONE',export_image_format='NONE')
