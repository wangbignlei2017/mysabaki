const {shell, clipboard, remote} = require('electron')
const {app} = remote || require('electron')

const setting = remote && remote.require('./setting')

const sabaki = typeof window !== 'undefined' && window.sabaki
const dialog = sabaki && require('./modules/dialog')
const gametree = sabaki && require('./modules/gametree')

let toggleSetting = key => setting.set(key, !setting.get(key))
let selectTool = tool => (sabaki.setMode('edit'), sabaki.setState({selectedTool: tool}))
let treePosition = () => sabaki.state.treePosition

let data = [
    {
        label: '&文件',
        submenu: [
            {
                label: '&新游戏',
                accelerator: 'CmdOrCtrl+N',
                click: () => sabaki.newFile({playSound: true, showInfo: true})
            },
            //{
            //    label: '新建 &窗口',
            //    accelerator: 'CmdOrCtrl+Shift+N',
            //    clickMain: 'newWindow',
             //   enabled: true
            //},
            {type: 'separator'},
            {
                label: '&打开…',
                accelerator: 'CmdOrCtrl+O',
                click: () => sabaki.loadFile()
            },
            {
                label: '&保存',
                accelerator: 'CmdOrCtrl+S',
                click: () => sabaki.saveFile(sabaki.state.representedFilename)
            },
            {
                label: '&另存为…',
                accelerator: 'CmdOrCtrl+Shift+S',
                click: () => sabaki.saveFile()
            },
            {type: 'separator'},
            {
                label: '&剪切板',
                submenu: [
                    {
                        label: '&重新加载棋谱',
                        click: () => sabaki.loadContent(clipboard.readText(), 'sgf', {ignoreEncoding: true})
                    },
                    {
                        label: '&复制棋谱',
                        click: () => clipboard.writeText(sabaki.getSGF())
                    },
                    {
                        label: '&复制文本棋谱',
                        click: () => clipboard.writeText(gametree.getBoard(...treePosition()).generateAscii())
                    }
                ]
            },
            {type: 'separator'},
            {
                label: '&当前局信息',
                accelerator: 'CmdOrCtrl+I',
                click: () => sabaki.openDrawer('info')
            },
            //{
              //  label: '&管理当前局…',
                //accelerator: 'CmdOrCtrl+Shift+M',
                //click: () => sabaki.openDrawer('gamechooser')
            //},
           // {type: 'separator'},
            //{
             //   label: '&Preferences…',
             //   accelerator: 'CmdOrCtrl+,',
             //   click: () => sabaki.openDrawer('preferences')
            //}
        ]
    },
    {
        label: '&游戏',
        submenu: [
            {
                label: '&切换玩家',
                click: () => sabaki.setPlayer(...treePosition(), -sabaki.getPlayer(...treePosition()))
            },
            //{type: 'separator'},
            //{
            //    label: '&Select Point',
            //    accelerator: 'CmdOrCtrl+L',
            //    click: () => dialog.showInputBox('Enter a coordinate to select a point', ({value}) => {
            //        sabaki.clickVertex(value)
            //    })
            //},
            {
                label: '&跳过',
                accelerator: 'CmdOrCtrl+P',
                click: () => sabaki.makeMove([-1, -1], {sendToEngine: true})
            },
            {
                label: '&认输',
                click: () => sabaki.makeResign()
            },
            {type: 'separator'},
            {
                label: '&估算',
                click: () => sabaki.setMode('estimator')
            },
            {
                label: '&计分',
                click: () => sabaki.setMode('scoring')
            }
        ]
    },
    {
        label: '&编辑',
        submenu: [
            {
                label: '&切换编辑模式',
                accelerator: 'CmdOrCtrl+E',
                click: () => sabaki.setMode(sabaki.state.mode === 'edit' ? 'play' : 'edit')
            },
            {
                label: '&清除标记…',
                click: () => sabaki.openDrawer('cleanmarkup')
            },
            {
                label: '&选择工具',
                submenu: [
                    {
                        label: '&选子',
                        accelerator: 'CmdOrCtrl+1',
                        click: () => selectTool('stone_1')
                    },
                    {
                        label: '&十字',
                        accelerator: 'CmdOrCtrl+2',
                        click: () => selectTool('cross')
                    },
                    {
                        label: '&三角形',
                        accelerator: 'CmdOrCtrl+3',
                        click: () => selectTool('triangle')
                    },
                    {
                        label: '&矩形',
                        accelerator: 'CmdOrCtrl+4',
                        click: () => selectTool('square')
                    },
                    {
                        label: '&圆形',
                        accelerator: 'CmdOrCtrl+5',
                        click: () => selectTool('circle')
                    },
                    {
                        label: '&线',
                        accelerator: 'CmdOrCtrl+6',
                        click: () => selectTool('line')
                    },
                    {
                        label: '&指针',
                        accelerator: 'CmdOrCtrl+7',
                        click: () => selectTool('arrow')
                    },
                    {
                        label: '&文本',
                        accelerator: 'CmdOrCtrl+8',
                        click: () => selectTool('label')
                    },
                    {
                        label: '&计数',
                        accelerator: 'CmdOrCtrl+9',
                        click: () => selectTool('number')
                    }
                ]
            },
            {type: 'separator'},
            {
                label: '&复制分支',
                click: () => sabaki.copyVariation(...treePosition())
            },
            {
                label: '&剪切分支',
                click: () => sabaki.cutVariation(...treePosition())
            },
            {
                label: '&粘贴分支',
                click: () => sabaki.pasteVariation(...treePosition())
            },
            {type: 'separator'},
            {
                label: '&设为主分支',
                click: () => sabaki.makeMainVariation(...treePosition())
            },
            {
                label: '&左移',
                click: () => sabaki.shiftVariation(...treePosition(), -1)
            },
            {
                label: '&右移',
                click: () => sabaki.shiftVariation(...treePosition(), 1)
            },
            {type: 'separator'},
            {
                label: '&平滑',
                click: () => sabaki.flattenVariation(...treePosition())
            },
            {
                label: '&清除节点',
                accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Backspace' : 'CmdOrCtrl+Delete',
                click: () => sabaki.removeNode(...treePosition())
            },
            {
                label: '&删除非当前分支',
                click: () => sabaki.removeOtherVariations(...treePosition())
            }
        ]
    },
      /* {
        label: 'Fin&d',
        submenu: [
            {
                label: 'Toggle &Find Mode',
                accelerator: 'CmdOrCtrl+F',
                click: () => sabaki.setMode(sabaki.state.mode === 'find' ? 'play' : 'find'),
            },
            {
                label: 'Find &Next',
                accelerator: 'F3',
                click: () => {
                    sabaki.setMode('find')
                    sabaki.findMove(1, {
                        vertex: sabaki.state.findVertex,
                        text: sabaki.state.findText
                    })
                }
            },
            {
                label: 'Find &Previous',
                accelerator: 'Shift+F3',
                click: () => {
                    sabaki.setMode('find')
                    sabaki.findMove(-1, {
                        vertex: sabaki.state.findVertex,
                        text: sabaki.state.findText
                    })
                }
            },
            {type: 'separator'},
            {
                label: 'Toggle &Hotspot',
                accelerator: 'CmdOrCtrl+B',
                click: () => sabaki.setComment(...treePosition(), {
                    hotspot: !('HO' in treePosition()[0].nodes[treePosition()[1]])
                })
            },
            {
                label: 'Jump to Ne&xt Hotspot',
                accelerator: 'F2',
                click: () => sabaki.findHotspot(1),
            },
            {
                label: 'Jump to Pre&vious Hotspot',
                accelerator: 'Shift+F2',
                click: () => sabaki.findHotspot(-1),
            }
        ]
    },*/
    {
        label: '&导航',
        submenu: [
            {
                label: '&后退',
                accelerator: 'Up',
                click: () => sabaki.goStep(-1)
            },
            {
                label: '&前进',
                accelerator: 'Down',
                click: () => sabaki.goStep(1)
            },
			/*
            {type: 'separator'},
            {
                label: '&Previous Fork',
                accelerator: 'CmdOrCtrl+Up',
                click: () => sabaki.goToPreviousFork()
            },
            {
                label: 'Go to &Next Fork',
                accelerator: 'CmdOrCtrl+Down',
                click: () => sabaki.goToNextFork()
            },
            {type: 'separator'},
            {
                label: 'Go to Previous Commen&t',
                accelerator: 'CmdOrCtrl+Shift+Up',
                click: () => sabaki.goToComment(-1)
            },
            {
                label: 'Go to Next &Comment',
                accelerator: 'CmdOrCtrl+Shift+Down',
                click: () => sabaki.goToComment(1)
            },*/
            {type: 'separator'},
            {
                label: '&转到开局',
                accelerator: 'Home',
                click: () => sabaki.goToBeginning()
            },
            {
                label: '&转到结尾',
                accelerator: 'End',
                click: () => sabaki.goToEnd()
            },
            {type: 'separator'},
            {
                label: '&转到主分支',
                accelerator: 'CmdOrCtrl+Left',
                click: () => sabaki.goToMainVariation()
            },
            {
                label: '&转到上一分支',
                accelerator: 'Left',
                click: () => sabaki.goToSiblingVariation(-1)
            },
            {
                label: '&转到下一分支',
                accelerator: 'Right',
                click: () => sabaki.goToSiblingVariation(1)
            },
            /*{type: 'separator'},
            {
                label: 'Go to Move N&umber',
                accelerator: 'CmdOrCtrl+G',
                click: () => dialog.showInputBox('Enter a move number to go to', ({value}) => {
                    sabaki.closeDrawer()
                    sabaki.goToMoveNumber(value)
                })
            },*/
            /*{type: 'separator'},
            {
                label: 'Go to Ne&xt Game',
                accelerator: 'CmdOrCtrl+PageDown',
                click: () => sabaki.goToSiblingGame(1)
            },
            {
                label: 'Go to Previou&s Game',
                accelerator: 'CmdOrCtrl+PageUp',
                click: () => sabaki.goToSiblingGame(-1)
            }*/
        ]
    },
    {
        label: '&引擎',
        submenu: [
            {
                label: '&加载…',
                click: () => sabaki.openDrawer('info')
            },
            {
                label: '&卸载',
                click: () => sabaki.detachEngines()
            },
            {
                label: '&暂停',
                click: () => sabaki.suspendEngines()
            },
            {type: 'separator'},
            {
                label: '&引擎管理…',
                click: () => (sabaki.setState({preferencesTab: 'engines'}), sabaki.openDrawer('preferences'))
            },
            {
                label: '&生成',
                accelerator: 'F5',
                click: () => sabaki.startGeneratingMoves()
            },
            {type: 'separator'},
            {
                label: '&转到GTP控制台',
                click: () => {
                    toggleSetting('view.show_leftsidebar')
                    sabaki.setState(({showConsole}) => ({showConsole: !showConsole}))
                }
            },
            {
                label: '&清除GTP控制台',
                click: () => sabaki.setState({consoleLog: []})
            }
        ]
    },
    {
        label: '&优势位',
        submenu: [
            {
                label: '&生成模态',
                click: () => sabaki.generateMode()
            },
            {
                label: '&自动更新模态',
                click: () => sabaki.suspendEngines()
            },
            
        ]
    },
    /*{
        label: '&View',
        submenu: [
            {
                label: 'Toggle Menu &Bar',
                click: () => toggleSetting('view.show_menubar')
            },
            {
                label: 'Toggle &Full Screen',
                accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Shift+F' : 'F11',
                click: () => sabaki.setState(({fullScreen}) => ({fullScreen: !fullScreen}))
            },
            {type: 'separator'},
            {
                label: 'Toggle Auto&play Mode',
                click: () => sabaki.setMode(sabaki.state.mode === 'autoplay' ? 'play' : 'autoplay')
            },
            {
                label: 'Toggle G&uess Mode',
                click: () => sabaki.setMode(sabaki.state.mode === 'guess' ? 'play' : 'guess')
            },
            {type: 'separator'},
            {
                label: 'Show &Coordinates',
                accelerator: 'CmdOrCtrl+Shift+C',
                checked: 'view.show_coordinates',
                click: () => toggleSetting('view.show_coordinates')
            },
            {
                label: 'Show Move Colori&zation',
                checked: 'view.show_move_colorization',
                click: () => toggleSetting('view.show_move_colorization')
            },
            {
                label: 'Show &Next Moves',
                checked: 'view.show_next_moves',
                click: () => toggleSetting('view.show_next_moves')
            },
            {
                label: 'Show &Sibling Variations',
                checked: 'view.show_siblings',
                click: () => toggleSetting('view.show_siblings')
            },
            {type: 'separator'},
            {
                label: 'Show Game &Tree',
                checked: 'view.show_graph',
                accelerator: 'CmdOrCtrl+T',
                click: () => {
                    toggleSetting('view.show_graph')
                    sabaki.setState(({showGameGraph}) => ({showGameGraph: !showGameGraph}))
                }
            },
            {
                label: 'Show Co&mments',
                checked: 'view.show_comments',
                accelerator: 'CmdOrCtrl+Shift+T',
                click: () => {
                    toggleSetting('view.show_comments')
                    sabaki.setState(({showCommentBox}) => ({showCommentBox: !showCommentBox}))
                }
            },
            {type: 'separator'},
            {
                label: 'Z&oom',
                submenu: [
                    {
                        label: 'Increase',
                        accelerator: 'CmdOrCtrl+Plus',
                        click: () => setting.set('app.zoom_factor',
                            setting.get('app.zoom_factor') + .1
                        )
                    },
                    {
                        label: 'Decrease',
                        accelerator: 'CmdOrCtrl+-',
                        click: () => setting.set('app.zoom_factor',
                            Math.max(0, setting.get('app.zoom_factor') - .1)
                        )
                    },
                    {
                        label: 'Reset',
                        accelerator: 'CmdOrCtrl+0',
                        click: () => setting.set('app.zoom_factor', 1)
                    }
                ]
            }
        ]
    },/*
    {
        label: '&Help',
        submenu: [
            {
                label: `${app.getName()} v${app.getVersion()}`,
                enabled: false
            },
            {
                label: 'Check for &Updates',
                clickMain: 'checkForUpdates',
                enabled: true
            },
            {type: 'separator'},
            {
                label: 'GitHub &Respository',
                click: () => shell.openExternal(`https://github.com/yishn/${sabaki.appName}`)
            },
            {
                label: 'Report &Issue',
                click: () => shell.openExternal(`https://github.com/yishn/${sabaki.appName}/issues`)
            }
        ]
    }*/
]

let findMenuItem = str => data.find(item => item.label.replace('&', '') === str)

// Modify menu for macOS

if (process.platform === 'darwin') {
    // Add 'App' menu

    let appMenu = [{role: 'about'}]
    let helpMenu = findMenuItem('Help')
    let items = helpMenu.submenu.splice(0, 3)

    appMenu.push(...items.slice(0, 2))

    // Remove original 'Preferences' menu item

    let fileMenu = findMenuItem('File')
    let preferenceItem = fileMenu.submenu.splice(fileMenu.submenu.length - 2, 2)[1]

    appMenu.push(
        {type: 'separator'},
        preferenceItem,
        {type: 'separator'},
        {submenu: [], role: 'services'},
        {
            label: 'Text',
            submenu: [
                {role: 'undo'},
                {role: 'redo'},
                {type: 'separator'},
                {role: 'cut'},
                {role: 'copy'},
                {role: 'paste'},
                {role: 'selectall'}
            ]
        },
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideothers'},
        {type: 'separator'},
        {role: 'quit'}
    )

    data.unshift({
        label: app.getName(),
        submenu: appMenu
    })

    // Add 'Window' menu

    data.splice(data.length - 1, 0, {
        submenu: [
            {
                label: 'New Window',
                clickMain: 'newWindow',
                enabled: true
            },
            {role: 'minimize'},
            {type: 'separator'},
            {role: 'front'}
        ],
        role: 'window'
    })

    // Remove 'Toggle Menu Bar' menu item

    let viewMenu = findMenuItem('View')
    viewMenu.submenu.splice(0, 1)
}

// Generate ids for all menu items

let generateIds = (menu, idPrefix = '') => {
    menu.forEach((item, i) => {
        item.id = idPrefix + i

        if ('submenu' in item) {
            generateIds(item.submenu, `${item.id}-`)
        }
    })
}

generateIds(data)

module.exports = exports = data

exports.clone = function(x = data) {
    if (Array.isArray(x)) {
        return [...Array(x.length)].map((_, i) => exports.clone(x[i]))
    } else if (typeof x === 'object') {
        let result = {}
        for (let key in x) result[key] = exports.clone(x[key])
        return result
    }

    return x
}
