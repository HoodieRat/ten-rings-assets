const WALKABLE_MAPS = [
  {
    map_id: 'ancient_stone_keep_demo',
    display_name: 'Ancient Stone Keep',
    theme: 'ancient',
    category: 'dungeon',
    perspective: 'top_down',
    width: 2304,
    height: 2048,
    tile_size: 16,
    walkable_pct: 0,
    bg_src: './static/img/maps/bg_01_ancient_stone_keep_tiled.png',
    walkable_src: './static/img/maps/bg_01_ancient_stone_keep_tiled_walkable.png',
    preview_src: './static/img/maps/bg_01_ancient_stone_keep_tiled_walkable.png',
    walk_meta_src: null,
    spawn_point: { x: 1152, y: 1331 },
    doors_src: './static/img/maps/bg_01_ancient_stone_keep_tiled_doors.json',
    doorsKey: 'ancient_stone_keep_demo_doors',
    actors_src: null,
    actorsKey: null
  }
];
window.WALKABLE_MAPS = WALKABLE_MAPS;
