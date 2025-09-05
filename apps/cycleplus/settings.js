(function(back) {
  const SETTINGS_FILE = "cycleplus.json";
  let settings = require('Storage').readJSON(SETTINGS_FILE, true) |

| {};

  function save(key, value) {
    settings[key] = value;
    require('Storage').writeJSON(SETTINGS_FILE, settings);
  }

  const menu = {
    '': { 'title': 'CyclePlus' },
    '< Back': back,
    'Rotation': {
      value: settings.rotation |

| 0,
      min: 0, max: 2,
      format: v =>[v],
      onchange: v => { save('rotation', v); }
    }
    // Add other settings here in the future
  };

  E.showMenu(menu);
})
