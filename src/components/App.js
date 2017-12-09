const fs = require('fs')
const EventEmitter = require('events')
const mysql  = require('mysql');
const {ipcRenderer, remote} = require('electron')
const {app, Menu} = remote
const {h, render, Component} = require('preact')
const classNames = require('classnames')

const ThemeManager = require('./ThemeManager')
const MainView = require('./MainView')
const LeftSidebar = require('./LeftSidebar')
const Sidebar = require('./Sidebar')
const DrawerManager = require('./DrawerManager')
const InputBox = require('./InputBox')
const BusyScreen = require('./BusyScreen')
const InfoOverlay = require('./InfoOverlay')

const Board = require('../modules/board')
const boardmatcher = require('../modules/boardmatcher')
const deadstones = require('../modules/deadstones')
const dialog = require('../modules/dialog')
const fileformats = require('../modules/fileformats')
const gametree = require('../modules/gametree')
const gtp = require('../modules/gtp')
const helper = require('../modules/helper')
const setting = remote.require('./setting')
const {sgf} = fileformats
const sound = require('../modules/sound')
// const mysqlhost = '172.19.0.102'
const mysqlhost = 'localhost'
const mysqlport = '3306'
const query=require("./mysql");
class App extends Component {
    constructor() {
        super()
        window.sabaki = this

        let emptyTree = gametree.new()
        emptyTree.nodes.push({})

        this.state = {
            mode: 'play',
            openDrawer: null,
            busy: false,
            autoplay: setting.get('game.autoplay'),
            fullScreen: false,
            showMenuBar: null,
            zoomFactor: null,

            representedFilename: null,
            gameTrees: [emptyTree],
            treePosition: [emptyTree, 0],

            // Bars

            undoable: false,
            undoText: 'Undo',
            selectedTool: 'stone_1',
            scoringMethod: null,
            findText: '',
            findVertex: null,
            deadStones: [],
            blockedGuesses: [],

            // Goban

            highlightVertices: [],
            showCoordinates: null,
            showMoveColorization: null,
            showNextMoves: null,
            showSiblings: null,
            fuzzyStonePlacement: null,
            animatedStonePlacement: null,
            animatedVertex: null,

            // Sidebar

            consoleLog: [],
            showConsole: setting.get('view.show_leftsidebar'),
            leftSidebarWidth: setting.get('view.leftsidebar_width'),
            showGameGraph: setting.get('view.show_graph'),
            showCommentBox: setting.get('view.show_comments'),
            sidebarWidth: setting.get('view.sidebar_width'),
            graphGridSize: null,
            graphNodeSize: null,

            // Engines

            engines: null,
            attachedEngines: [null, null],
            engineCommands: [[], []],
            generatingMoves: false,

            // Drawers

            preferencesTab: 'general',

            // Input Box

            showInputBox: false,
            inputBoxText: '',
            onInputBoxSubmit: helper.noop,
            onInputBoxCancel: helper.noop,

            // Info Overlay

            infoOverlayText: '',
            showInfoOverlay: false
        }

          
 
        //this.connection = mysql.createConnection({     
        //host     : mysqlhost,       
        //user     : 'root',              
        //password : '',       
        //port: mysqlport,                   
        //database: 'weiqi', 
        //});  
        //this.connection.connect();
        var  sql = 'SELECT * FROM factor order by GID desc limit 1';
        this.gid = 1;
        //查
        query(sql,'',this.handlemysql);

        this.events = new EventEmitter()
        this.appName = app.getName()
        this.version = app.getVersion()
        this.window = remote.getCurrentWindow()

        this.treeHash = this.generateTreeHash()
        this.attachedEngineControllers = [null, null]
        this.engineBoards = [null, null]
        let curtime = new Date()
        this.starttime = curtime.toLocaleString()

        // Expose submodules

        this.modules = {Board, boardmatcher, deadstones, dialog,
            fileformats, gametree, gtp, helper, setting, sound}

        // Bind state to settings

        setting.events.on('change', ({key}) => this.updateSettingState(key))
        this.updateSettingState()
    }
    handlemysql(err, result,fei)
    {
        for (var k = 0, length = result.length; k < length; k++)
        {
            if(result[k].GID >= window.sabaki.gid)
            {
                window.sabaki.gid = result[k].GID + 1;
            }
        }
        window.sabaki.startGeneratingMoves()
    }
    componentDidMount() {
        window.addEventListener('contextmenu', evt => {
            evt.preventDefault()
        })

        window.addEventListener('load', () => {
            this.events.emit('ready')
            this.window.show()
        })

        ipcRenderer.on('load-file', (evt, ...args) => {
            setTimeout(() => this.loadFile(...args), setting.get('app.loadgame_delay'))
        })

        this.window.on('focus', () => {
            if (setting.get('file.show_reload_warning')) {
                this.askForReload()
            }

            ipcRenderer.send('build-menu', this.state.busy)
        })

        this.window.on('resize', () => {
            clearTimeout(this.resizeId)

            this.resizeId = setTimeout(() => {
                if (!this.window.isMaximized() && !this.window.isMinimized() && !this.window.isFullScreen()) {
                    let [width, height] = this.window.getContentSize()
                    setting.set('window.width', width).set('window.height', height)
                }
            }, 1000)
        })

        // Handle main menu items

        let menuData = require('../menu')

        let handleMenuClicks = menu => {
            for (let item of menu) {
                if ('click' in item) {
                    ipcRenderer.on(`menu-click-${item.id}`, () => {
                        if (!this.state.showMenuBar) this.window.setMenuBarVisibility(false)
                        dialog.closeInputBox()
                        item.click()
                    })
                }

                if ('submenu' in item) {
                    handleMenuClicks(item.submenu)
                }
            }
        }

        handleMenuClicks(menuData)

        // Handle mouse wheel

        for (let el of document.querySelectorAll('#main main, #graph')) {
            el.addEventListener('wheel', evt => {
                evt.preventDefault()

                if (this.residueDeltaY == null) this.residueDeltaY = 0
                this.residueDeltaY += evt.deltaY

                if (Math.abs(this.residueDeltaY) >= setting.get('game.navigation_sensitivity')) {
                    this.goStep(Math.sign(this.residueDeltaY))
                    this.residueDeltaY = 0
                }
            })
        }

        // Handle file drag & drop

        document.body.addEventListener('dragover', evt => evt.preventDefault())
        document.body.addEventListener('drop', evt => {
            evt.preventDefault()

            if (evt.dataTransfer.files.length === 0) return
            this.loadFile(evt.dataTransfer.files[0].path)
        })

        // Handle escape key

        document.addEventListener('keyup', evt => {
            if (evt.keyCode === 27) {
                // Escape

                if (this.state.generatingMoves) {
                    this.stopGeneratingMoves()
                } else if (this.state.openDrawer != null) {
                    this.closeDrawer()
                } else if (this.state.mode !== 'play') {
                    this.setMode('play')
                } else if (this.state.fullScreen) {
                    this.setState({fullScreen: false})
                }
            }
        })

        // Handle window closing

        window.addEventListener('beforeunload', evt => {
            if (this.closeWindow) return

            evt.returnValue = ' '

            setTimeout(() => {
                if (this.askForSave()) {
                    this.detachEngines()
                    this.closeWindow = true
                    this.window.close()
                }
            })
        })

        this.newFile()
    }

    componentDidUpdate(_, prevState = {}) {
        // Update title

        let {basename} = require('path')
        let title = this.appName
        let {representedFilename, gameTrees, treePosition: [tree, ]} = this.state

        if (representedFilename)
            title = basename(representedFilename)
        if (gameTrees.length > 1)
            title += ' — Game ' + (this.inferredState.gameIndex + 1)
        if (representedFilename && process.platform != 'darwin')
            title += ' — ' + this.appName

        if (document.title !== title)
            document.title = title

        // Handle full screen & menu bar

        if (prevState.fullScreen !== this.state.fullScreen) {
            if (this.state.fullScreen) this.flashInfoOverlay('按 Esc 退出全屏模式')
            this.window.setFullScreen(this.state.fullScreen)
        }

        if (prevState.showMenuBar !== this.state.showMenuBar) {
            if (!this.state.showMenuBar) this.flashInfoOverlay('按 Alt 显示菜单')
            this.window.setMenuBarVisibility(this.state.showMenuBar)
            this.window.setAutoHideMenuBar(!this.state.showMenuBar)
        }

        // Handle sidebar showing/hiding

        if (prevState.showLeftSidebar !== this.state.showLeftSidebar
        || prevState.showSidebar !== this.state.showSidebar) {
            let [width, height] = this.window.getContentSize()
            let widthDiff = 0

            if (prevState.showSidebar !== this.state.showSidebar) {
                widthDiff += this.state.sidebarWidth * (this.state.showSidebar ? 1 : -1)
            }

            if (prevState.showLeftSidebar !== this.state.showLeftSidebar) {
                widthDiff += this.state.leftSidebarWidth * (this.state.showLeftSidebar ? 1 : -1)
            }

            if (!this.window.isMaximized() && !this.window.isMinimized() && !this.window.isFullScreen()) {
                this.window.setContentSize(width + widthDiff, height)
            }
        }

        // Handle zoom factor

        if (prevState.zoomFactor !== this.state.zoomFactor) {
            this.window.webContents.setZoomFactor(this.state.zoomFactor)
        }
    }

    updateSettingState(key = null) {
        let data = {
            'app.zoom_factor': 'zoomFactor',
            'view.show_menubar': 'showMenuBar',
            'view.show_coordinates': 'showCoordinates',
            'view.show_move_colorization': 'showMoveColorization',
            'view.show_next_moves': 'showNextMoves',
            'view.show_siblings': 'showSiblings',
            'view.fuzzy_stone_placement': 'fuzzyStonePlacement',
            'view.animated_stone_placement': 'animatedStonePlacement',
            'graph.grid_size': 'graphGridSize',
            'graph.node_size': 'graphNodeSize',
            'engines.list': 'engines',
            'scoring.method': 'scoringMethod'
        }

        if (key == null) {
            for (let k in data) this.updateSettingState(k)
            return
        }

        if (key in data) {
            ipcRenderer.send('build-menu', this.state.busy)
            this.setState({[data[key]]: setting.get(key)})
        }
    }

    // User Interface

    setSidebarWidth(sidebarWidth) {
        this.setState({sidebarWidth}, () => window.dispatchEvent(new Event('resize')))
    }

    setLeftSidebarWidth(leftSidebarWidth) {
        this.setState({leftSidebarWidth}, () => window.dispatchEvent(new Event('resize')))
    }

    setMode(mode) {
        let stateChange = {mode}

        if (['scoring', 'estimator'].includes(mode)) {
            // Guess dead stones

            let {guess} = require('../modules/deadstones')
            let {treePosition} = this.state
            let iterations = setting.get('score.estimator_iterations')
            let deadStones = guess(gametree.getBoard(...treePosition), mode === 'scoring', iterations)

            Object.assign(stateChange, {deadStones})
        }

        this.setState(stateChange)
        this.events.emit('modeChange')
    }

    openDrawer(drawer) {
        this.setState({openDrawer: drawer})
    }

    closeDrawer() {
        if(this.state.openDrawer === 'info')
        {
            let [tree, index] = this.state.treePosition   
            let gameInfo = this.getGameInfo(tree)
            if(gameInfo.blackName ===null || gameInfo.blackName ==="")
            {
                return
            }
            if(gameInfo.whiteName ===null || gameInfo.whiteName ==="")
            {
                return
            }
            
        }
        document.activeElement.blur()
        this.openDrawer(null)
    }

    setBusy(busy) {
        this.setState({busy})
    }

    showInfoOverlay(text) {
        this.setState({
            infoOverlayText: text,
            showInfoOverlay: true
        })
    }

    hideInfoOverlay() {
        this.setState({showInfoOverlay: false})
    }

    flashInfoOverlay(text) {
        this.showInfoOverlay(text)
        setTimeout(() => this.hideInfoOverlay(), setting.get('infooverlay.duration'))
    }

    // File Management

    getEmptyGameTree() {
        let handicap = setting.get('game.default_handicap')
        let size = setting.get('game.default_board_size').toString().split(':').map(x => +x)
        let [width, height] = [size[0], size.slice(-1)[0]]
        let handicapStones = new Board(width, height).getHandicapPlacement(handicap).map(sgf.vertex2point)

        let sizeInfo = width === height ? width.toString() : `${width}:${height}`
        let handicapInfo = handicapStones.length > 0 ? `HA[${handicap}]AB[${handicapStones.join('][')}]` : ''
        let date = new Date()
        let dateInfo = sgf.dates2string([[date.getFullYear(), date.getMonth() + 1, date.getDate()]])

        return sgf.parse(`
            (;GM[1]FF[4]CA[UTF-8]AP[${this.appName}:${this.version}]
            KM[${setting.get('game.default_komi')}]
            SZ[${sizeInfo}]DT[${dateInfo}]
            ${handicapInfo})
        `)[0]
    }

    newFile({playSound = false, showInfo = false, suppressAskForSave = false} = {}) {
        if (!suppressAskForSave && !this.askForSave()) return
        let [tree, index] = this.state.treePosition   
        let gameInfo = this.getGameInfo(tree)
        if(gameInfo.blackName ===null || gameInfo.blackName ==="")
        {
            showInfo = true
        }
        if(gameInfo.whiteName ===null || gameInfo.whiteName ==="")
        {
            showInfo = true
        }
        if (showInfo && this.state.openDrawer === 'info') this.closeDrawer()
        this.setMode('play')

        this.clearUndoPoint()
        if(!this.state.autoplay)
		{
            this.detachEngines()
		}
		else
		{
			let oldengines = this.state.attachedEngines
			this.detachEngines()
			console.time("start")
			console.time("end")
			console.log(oldengines)
			this.attachEngines(...oldengines)
		}
        this.setState(this.state, () => {

            let emptyTree = this.getEmptyGameTree()
            if(this.state.autoplay)
            {
                this.setGameInfo(emptyTree,gameInfo)
                
            }
            this.setState({
                openDrawer: showInfo ? 'info' : null,
                gameTrees: [emptyTree],
                treePosition: [emptyTree, 0],
                representedFilename: null
            })
            //this.setPlayer(this.state.treePosition,0, 1)
            this.treeHash = this.generateTreeHash()
            this.fileHash = this.generateFileHash()
         
            if (playSound) sound.playNewGame()
            //filenew     
            var  sql = 'SELECT * FROM factor order by GID desc limit 1';      
            query(sql,'',this.handlemysql);
            let curtime = new Date()
            this.starttime = curtime.toLocaleString()
        })
    }
    importFromeFile(filename = null, {suppressAskForSave = false} = {}) {
        if (!suppressAskForSave && !this.askForSave()) return

        if (!filename) {
            dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [...fileformats.meta, {name: 'All Files', extensions: ['*']}]
            }, ({result}) => {
                if (result) filename = result[0]
                if (filename) this.loadFile(filename, {suppressAskForSave: true})
            })

            return
        }

        let {extname} = require('path')
        let extension = extname(filename).slice(1)
        let content = fs.readFileSync(filename, {encoding: 'binary'})

        this.loadContentforimport(content, extension, {
            suppressAskForSave: true,
            callback: err => {
                if (err) return

                this.setState({representedFilename: filename})
                this.fileHash = this.generateFileHash()

                if (setting.get('game.goto_end_after_loading')) {
                    this.goToEnd()
                }
            }
        })
    }
    loadContentforimport(content, extension, {suppressAskForSave = false, ignoreEncoding = false, callback = helper.noop} = {}) {
        if (!suppressAskForSave && !this.askForSave()) return

        this.setBusy(true)
        if (this.state.openDrawer !== 'gamechooser') this.closeDrawer()
        this.setMode('play')

        setTimeout(() => {
            let lastProgress = -1
            let error = false
            let gameTrees = []

            try {
                let fileFormatModule = fileformats.getModuleByExtension(extension)

                gameTrees = fileFormatModule.parse(content, evt => {
                    if (evt.progress - lastProgress < 0.1) return
                    this.window.setProgressBar(evt.progress)
                    lastProgress = evt.progress
                }, ignoreEncoding)

                if (gameTrees.length == 0) throw true
            } catch (err) {
                dialog.showMessageBox('文件不可用.', 'warning')
                error = true
            }

            if (gameTrees.length != 0) {
                this.clearUndoPoint()
                this.detachEngines()
                let emptyTree = this.getEmptyGameTree()
                
                this.setState({
                    representedFilename: null,
                    gameTrees,
                    treePosition: [gameTrees[0], 0]
                })

                this.treeHash = this.generateTreeHash()
                this.fileHash = this.generateFileHash()
            }

            this.setBusy(false)

            if (gameTrees.length > 1) {
                setTimeout(() => {
                    this.openDrawer('gamechooser')
                }, setting.get('gamechooser.show_delay'))
            }

            this.window.setProgressBar(-1)
            callback(error)

            if (!error) this.events.emit('fileLoad')
        }, setting.get('app.loadgame_delay'))
    }
    loadFile(filename = null, {suppressAskForSave = false} = {}) {
        if (!suppressAskForSave && !this.askForSave()) return

        if (!filename) {
            dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [...fileformats.meta, {name: 'All Files', extensions: ['*']}]
            }, ({result}) => {
                if (result) filename = result[0]
                if (filename) this.loadFile(filename, {suppressAskForSave: true})
            })

            return
        }

        let {extname} = require('path')
        let extension = extname(filename).slice(1)
        let content = fs.readFileSync(filename, {encoding: 'binary'})

        this.loadContent(content, extension, {
            suppressAskForSave: true,
            callback: err => {
                if (err) return

                this.setState({representedFilename: filename})
                this.fileHash = this.generateFileHash()

                if (setting.get('game.goto_end_after_loading')) {
                    this.goToEnd()
                }
            }
        })
    }

    loadContent(content, extension, {suppressAskForSave = false, ignoreEncoding = false, callback = helper.noop} = {}) {
        if (!suppressAskForSave && !this.askForSave()) return

        this.setBusy(true)
        if (this.state.openDrawer !== 'gamechooser') this.closeDrawer()
        this.setMode('play')

        setTimeout(() => {
            let lastProgress = -1
            let error = false
            let gameTrees = []

            try {
                let fileFormatModule = fileformats.getModuleByExtension(extension)

                gameTrees = fileFormatModule.parse(content, evt => {
                    if (evt.progress - lastProgress < 0.1) return
                    this.window.setProgressBar(evt.progress)
                    lastProgress = evt.progress
                }, ignoreEncoding)

                if (gameTrees.length == 0) throw true
            } catch (err) {
                dialog.showMessageBox('文件不可用.', 'warning')
                error = true
            }

            if (gameTrees.length != 0) {
                this.clearUndoPoint()
                this.detachEngines()
                console.log(gameTrees)
                this.setState({
                    representedFilename: null,
                    gameTrees,
                    treePosition: [gameTrees[0], 0]
                })
                
                this.treeHash = this.generateTreeHash()
                this.fileHash = this.generateFileHash()
            }

            this.setBusy(false)

            if (gameTrees.length > 1) {
                setTimeout(() => {
                    this.openDrawer('gamechooser')
                }, setting.get('gamechooser.show_delay'))
            }

            this.window.setProgressBar(-1)
            callback(error)

            if (!error) this.events.emit('fileLoad')
        }, setting.get('app.loadgame_delay'))
    }

    saveFile(filename = null) {
        if (!filename) {
            let cancel = false

            dialog.showSaveDialog({
                filters: [sgf.meta, {name: 'All Files', extensions: ['*']}]
            }, ({result}) => {
                if (result) this.saveFile(result)
                cancel = !result
            })

            return !cancel
        }

        this.setBusy(true)
        fs.writeFileSync(filename, this.getSGF())

        this.setBusy(false)
        this.setState({representedFilename: filename})

        this.treeHash = this.generateTreeHash()
        this.fileHash = this.generateFileHash()

        return true
    }
    autosaveFile() {
        let filename=this.gid.toString()+".sgf" 
 
        this.setBusy(true)
        fs.writeFileSync(filename, this.getSGF())

        this.setBusy(false)
        this.setState({representedFilename: filename})

        this.treeHash = this.generateTreeHash()
        this.fileHash = this.generateFileHash()
    }

    getSGF() {
        let {gameTrees} = this.state

        for (let tree of gameTrees) {
            Object.assign(tree.nodes[0], {
                AP: [`${this.appName}:${this.version}`],
                CA: ['UTF-8']
            })
        }

        return sgf.stringify(gameTrees)
    }

    generateTreeHash() {
        return this.state.gameTrees.map(tree => gametree.getHash(tree)).join('')
    }

    generateFileHash() {
        let {representedFilename} = this.state
        if (!representedFilename) return null

        try {
            let content = fs.readFileSync(representedFilename, 'utf8')
            return helper.hash(content)
        } catch (err) {}

        return null
    }

    askForSave() {
        let hash = this.generateTreeHash()

        if (hash !== this.treeHash) {
            let answer = dialog.showMessageBox(
                '如果选择不保存的话，就会丢失所有更改',
                'warning',
                ['保存', '不保存', '取消'], 2
            )

            if (answer === 0) return this.saveFile(this.state.representedFilename)
            else if (answer === 2) return false
        }

        return true
    }

    askForReload() {
        let hash = this.generateFileHash()

        if (hash != null && hash !== this.fileHash) {
            let answer = dialog.showMessageBox([
                `文件已被其他程序更改，是否需要重新加载`,
                '是否重新加载? 你的更改将丢失.'
            ].join('\n'), 'warning', ['重新加载', '不重新加载'], 1)

            if (answer === 0) {
                this.loadFile(this.state.representedFilename, {suppressAskForSave: true})
            } else {
                this.treeHash = null
            }

            this.fileHash = hash
        }
    }

    // Playing

    clickVertex(vertex, {button = 0, ctrlKey = false, x = 0, y = 0} = {}) {
        
        this.closeDrawer()

        let [tree, index] = this.state.treePosition
        let board = gametree.getBoard(tree, index)
        let node = tree.nodes[index]

        if (typeof vertex == 'string') {
            vertex = board.coord2vertex(vertex)
        }

        if (['play', 'autoplay'].includes(this.state.mode)) {
            if (button === 0) {
                let [tree, index] = this.state.treePosition   
                let gameInfo = this.getGameInfo(tree)
                if(gameInfo.blackName ===null || gameInfo.blackName ==="")
                {
                    this.setState({openDrawer: 'info' })
                    return
                }
                if(gameInfo.whiteName ===null || gameInfo.whiteName==="")
                {
                    this.setState({openDrawer: 'info' })
                    return
                }
                if (board.get(vertex) === 0) {
                    console.log("makeMove")
                    this.makeMove(vertex, {sendToEngine: true})
                } else if (vertex in board.markups
                && board.markups[vertex][0] === 'point'
                && setting.get('edit.click_currentvertex_to_remove')) {
                    this.removeNode(tree, index)
                }
            } else if (button === 2) {
                if (vertex in board.markups && board.markups[vertex][0] === 'point') {
                    this.openCommentMenu(tree, index, {x, y})
                }
            }
        } else if (this.state.mode === 'edit') {
            if (ctrlKey) {
                // Add coordinates to comment

                let coord = board.vertex2coord(vertex)
                let commentText = node.C ? node.C[0] : ''

                node.C = commentText !== '' ? [commentText.trim() + ' ' + coord] : [coord]
                return
            }

            let tool = this.state.selectedTool

            if (button === 2) {
                // Right mouse click

                if (['stone_1', 'stone_-1'].includes(tool)) {
                    // Switch stone tool

                    tool = tool === 'stone_1' ? 'stone_-1' : 'stone_1'
                } else if (['number', 'label'].includes(tool)) {
                    // Show label editing context menu

                    let click = () => dialog.showInputBox('Enter label text', ({value}) => {
                        this.useTool('label', vertex, value)
                    })

                    let template = [{label: '&Edit Label', click}]
                    helper.popupMenu(template, x, y)

                    return
                }
            }

            if (['line', 'arrow'].includes(tool)) {
                // Remember clicked vertex and pass as an argument the second time

                if (!this.editVertexData || this.editVertexData[0] !== tool) {
                    this.useTool(tool, vertex)
                    this.editVertexData = [tool, vertex]
                } else {
                    this.useTool(tool, vertex, this.editVertexData[1])
                    this.editVertexData = null
                }
            } else {
                this.useTool(tool, vertex)
                this.editVertexData = null
            }
        } else if (['scoring', 'estimator'].includes(this.state.mode)) {
            if (button !== 0 || board.get(vertex) === 0) return

            let {mode, deadStones} = this.state
            let dead = deadStones.some(v => helper.vertexEquals(v, vertex))
            let stones = mode === 'estimator' ? board.getChain(vertex) : board.getRelatedChains(vertex)

            if (!dead) {
                deadStones = [...deadStones, ...stones]
            } else {
                deadStones = deadStones.filter(v => !stones.some(w => helper.vertexEquals(v, w)))
            }

            this.setState({deadStones})
        } else if (this.state.mode === 'find') {
            if (button !== 0) return

            if (helper.vertexEquals(this.state.findVertex || [-1, -1], vertex)) {
                this.setState({findVertex: null})
            } else {
                this.setState({findVertex: vertex})
                this.findMove(1, {vertex, text: this.state.findText})
            }
        } else if (this.state.mode === 'guess') {
            if (button !== 0) return

            let tp = gametree.navigate(...this.state.treePosition, 1)
            if (!tp) return this.setMode('play')

            let nextNode = tp[0].nodes[tp[1]]
            if (!('B' in nextNode || 'W' in nextNode)) return this.setMode('play')

            let nextVertex = sgf.point2vertex(nextNode['B' in nextNode ? 'B' : 'W'][0])
            let board = gametree.getBoard(...this.state.treePosition)
            if (!board.hasVertex(nextVertex)) return this.setMode('play')

            if (helper.vertexEquals(vertex, nextVertex)) {
                console.log("makeMove")
                this.makeMove(vertex, {player: 'B' in nextNode ? 1 : -1})
            } else {
                if (board.get(vertex) !== 0
                || this.state.blockedGuesses.some(v => helper.vertexEquals(v, vertex)))
                    return

                let blocked = []
                let [, i] = vertex.map((x, i) => Math.abs(x - nextVertex[i]))
                    .reduce(([max, i], x, j) => x > max ? [x, j] : [max, i], [-Infinity, -1])

                for (let x = 0; x < board.width; x++) {
                    for (let y = 0; y < board.height; y++) {
                        let z = i === 0 ? x : y
                        if (Math.abs(z - vertex[i]) < Math.abs(z - nextVertex[i]))
                            blocked.push([x, y])
                    }
                }

                let {blockedGuesses} = this.state
                blockedGuesses.push(...blocked)
                this.setState({blockedGuesses})
            }
        }

        this.events.emit('vertexClick')
    }

    makeMove(vertex, {player = null, clearUndoPoint = true, sendToEngine = false} = {}) {
        if (!['play', 'autoplay', 'guess'].includes(this.state.mode)) {
            this.closeDrawer()
            this.setMode('play')
        }

        let [tree, index] = this.state.treePosition
        let board = gametree.getBoard(tree, index)

        if (typeof vertex == 'string') {
            vertex = board.coord2vertex(vertex)
        }

        let pass = !board.hasVertex(vertex)
        if (!pass && board.get(vertex) !== 0) return

        let prev = gametree.navigate(tree, index, -1)
        if (!player) player = this.inferredState.currentPlayer
        let color = player > 0 ? 'B' : 'W'
        let capture = false, suicide = false, ko = false
        let createNode = true

        if (!pass) {
            // Check for ko

            if (prev && setting.get('game.show_ko_warning')) {
                console.log("makeMove")
                let hash = board.makeMove(player, vertex).getPositionHash()

                ko = prev[0].nodes[prev[1]].board.getPositionHash() == hash

                if (ko && dialog.showMessageBox(
                    ['You are about to play a move which repeats a previous board position.',
                    'This is invalid in some rulesets.'].join('\n'),
                    'info',
                    ['Play Anyway', 'Don’t Play'], 1
                ) != 0) return
            }

            let vertexNeighbors = board.getNeighbors(vertex)

            // Check for suicide

            capture = vertexNeighbors
                .some(v => board.get(v) == -player && board.getLiberties(v).length == 1)

            suicide = !capture
            && vertexNeighbors.filter(v => board.get(v) == player)
                .every(v => board.getLiberties(v).length == 1)
            && vertexNeighbors.filter(v => board.get(v) == 0).length == 0

            if (suicide && setting.get('game.show_suicide_warning')) {
                if (dialog.showMessageBox(
                    ['You are about to play a suicide move.',
                    'This is invalid in some rulesets.'].join('\n'),
                    'info',
                    ['Play Anyway', 'Don’t Play'], 1
                ) != 0) return
            }

            // Animate board

            this.setState({animatedVertex: vertex})
        }

        // Update data

        let nextTreePosition

        if (tree.subtrees.length === 0 && tree.nodes.length - 1 === index) {
            // Append move

            let node = {}
            node[color] = [sgf.vertex2point(vertex)]
            tree.nodes.push(node)

            nextTreePosition = [tree, tree.nodes.length - 1]
        } else {
            if (index !== tree.nodes.length - 1) {
                // Search for next move

                let nextNode = tree.nodes[index + 1]
                let moveExists = color in nextNode
                    && helper.vertexEquals(sgf.point2vertex(nextNode[color][0]), vertex)

                if (moveExists) {
                    nextTreePosition = [tree, index + 1]
                    createNode = false
                }
            } else {
                // Search for variation

                let variations = tree.subtrees.filter(subtree => {
                    return subtree.nodes.length > 0
                        && color in subtree.nodes[0]
                        && helper.vertexEquals(sgf.point2vertex(subtree.nodes[0][color][0]), vertex)
                })

                if (variations.length > 0) {
                    nextTreePosition = [variations[0], 0]
                    createNode = false
                }
            }

            if (createNode) {
                // Create variation

                let updateRoot = tree.parent == null
                let splitted = gametree.split(tree, index)
                let newTree = gametree.new()
                let node = {[color]: [sgf.vertex2point(vertex)]}

                newTree.nodes = [node]
                newTree.parent = splitted

                splitted.subtrees.push(newTree)
                splitted.current = splitted.subtrees.length - 1

                if (updateRoot) {
                    let {gameTrees} = this.state
                    gameTrees[gameTrees.indexOf(tree)] = splitted
                }

                nextTreePosition = [newTree, 0]
            }
        }

        this.setCurrentTreePosition(...nextTreePosition)

        // Play sounds

        if (!pass) {
            let delay = setting.get('sound.capture_delay_min')
            delay += Math.floor(Math.random() * (setting.get('sound.capture_delay_max') - delay))

            if (capture || suicide)
                sound.playCapture(delay)

            sound.playPachi()
        } else {
            sound.playPass()
        }

        // Clear undo point

        if (createNode && clearUndoPoint) this.clearUndoPoint()

        // Enter scoring mode after two consecutive passes

        let enterScoring = false

        if (pass && createNode && prev) {
            let prevNode = tree.nodes[index]
            let prevColor = color === 'B' ? 'W' : 'B'
            console.log(prevNode)
            console.log(prevColor)
            let prevPass = prevColor in prevNode && prevNode[prevColor][0] === ''
            
            if (prevPass) {

                
                console.log(this.state.autoplay)
                if(this.state.autoplay)
                {
                    this.endgame(null)
                    return
                }
                else
                {
                    enterScoring = true
                    this.setMode('scoring')
                }
            }
        }

        // Emit event

        this.events.emit('moveMake', {pass, capture, suicide, ko, enterScoring})
        var myDate = new Date();
        var curtime = myDate.toLocaleString();
        // write records to mysql 
        var  addSql = 'INSERT INTO factor(GID,SID,x,y,class,time) VALUES(?,?,?,?,?,?)';
        var  addSqlParams = [ this.gid,index + 1,vertex[0]+1,vertex[1]+1, player,curtime];
       //增
        query(addSql,addSqlParams,function (err, result) {
            if(err){
             console.log('[INSERT ERROR] - ',err.message);
             return;
              }        
       });
       if(index > 1)
       {
           var  updateSql = 'UPDATE  factor SET adv_p = ? WHERE GID = ?  AND SID = ?';
           var strav_p = '['+(vertex[0]+1).toString()+","+(vertex[1]+1).toString()+']'
         //  console.log(strav_p )
           var  updateSqlParams = [strav_p, this.gid,index -1];
			query(updateSql,updateSqlParams,function (err, result) {
                if(err){
                 console.log('[INSERT ERROR] - ',err.message);
                 return;
                  }        
           });
       }
       //add records to table state_board
        let [newtree, newindex] = this.state.treePosition
        let newboard = gametree.getBoard(newtree, newindex)
		var str =""
        for(var y =0;y <19;y++)
        {
            for(var x =0;x <19;x++)
            {
                
               
       //         var  addboardSql = 'INSERT INTO board(GID,SID,x,y,black,white,createtime) VALUES(?,?,?,?,?,?,?)';
       //         var  addboardSqlParams = [ this.gid,index + 1,x+1,y+1,0 ,0,curtime];
                let v = [x,y];
                var cur = newboard.get(v);		
			    
				//console.log(cur)
				//console.log(str)
                if(cur == 1)
                {
                //    addboardSqlParams[4] = cur;
                    str=str+String(cur)
                }
                 if(cur == 0)
                {
                    str=str+String(cur)
                }
                 if(cur == -1)
                {
                //   addboardSqlParams[5] = cur;
                    str=str+'4'
                }
               //增
            /*     this.connection.query(addboardSql,addboardSqlParams,function (err, result) {
                    if(err){
                     console.log('[INSERT ERROR] - ',err.message);
                     return;
                      }        
               }); */
               
            }
        }
		
		var  addboardSql = 'INSERT INTO state_board(GID,SID,boards,createtime) VALUES(?,?,?,?)';
        var  addboardSqlParams = [ this.gid,index + 1,str,curtime];
		
        query(addboardSql,addboardSqlParams,function (err, result) {
                if(err){
                 console.log('[INSERT ERROR] - ',err.message);
                 return;
                  }        
        });
        // Send command to engine
        console.log(sendToEngine)
        if (sendToEngine && this.attachedEngineControllers.some(x => x != null)) {
            let passPlayer = pass ? player : null
            setTimeout(() => this.startGeneratingMoves({passPlayer}), setting.get('gtp.move_delay'))
        }
    }
    endgame(resignplayer = null){
        console.log(resignplayer)
        let {guess} = require('../modules/deadstones')
        let {treePosition} = this.state
        let iterations = setting.get('score.estimator_iterations')
        let deadStones = guess(gametree.getBoard(...treePosition), true, iterations)

        //Object.assign(stateChange, {deadStones})
        ////add records to table game
        let scoreBoard = gametree.getBoard(...treePosition).clone()

        for (let vertex of deadStones) {
            let sign = scoreBoard.get(vertex)
            if (sign === 0) continue

            scoreBoard.captures[sign > 0 ? 1 : 0]++
            scoreBoard.set(vertex, 0)
        }

        let areaMap = scoreBoard.getAreaMap()
        let score = scoreBoard.getScore(areaMap) 
        let [tree, index] = this.state.treePosition
        //let board = gametree.getBoard(tree, index)
        //let map = board.getAreaMap()
            
        let gameInfo = this.getGameInfo(tree)
        // console.log()        
       // let numArea=Math.abs(score.area[0]-score.area[1]-gameInfo.komi)
       // let numTer=Math.abs(score.territory[0]-score.territory[1]+score.captures[0] - score.captures[1]-gameInfo.komi)
        let {gameName, eventName, blackName, blackRank, whiteName, whiteRank,komi} = gameInfo
        let numArea=score.area[0]-score.area[1]-komi
        let numTer=score.territory[0]-score.territory[1]+score.captures[0] - score.captures[1]-komi
     
        
        var curtime = new Date()
        var endtime = curtime.toLocaleString()
       if(resignplayer == null)
           resignplayer = numArea > 0?-2:2;
           let color = numArea > 0 ? 'B' : 'W'
           let {rootTree} = this.inferredState
           let rootNode = rootTree.nodes[0]
           rootNode.RE = [`${color}+${numArea}`]
               
       var  addgameSql = 'INSERT INTO game(GID,loser,playerB,playerW,numArea,numTer,starttime,endtime,komi,steps) VALUES(?,?,?,?,?,?,?,?,?,?)';
       var  addgameSqlParams = [ this.gid,resignplayer,blackName,whiteName,numArea,numTer,this.starttime,endtime,komi,index-1];
       console.log(addgameSql)
       query(addgameSql,addgameSqlParams,function (err, result) {
            if(err){
             console.log('[INSERT ERROR] - ',err.message);
             return;
              }        
       });
        if(this.state.autoplay)
        {
            this.newFile({suppressAskForSave:true})
            if(this.attachedEngineControllers[0]!=null)
                this.sendGTPCommand(this.attachedEngineControllers[0], new gtp.Command(null, 'clear_board'))
            if(this.attachedEngineControllers[1]!=null)
                this.sendGTPCommand(this.attachedEngineControllers[1], new gtp.Command(null, 'clear_board'))
            this.inferredState.currentPlayer = 1
            
        }
        this.autosaveFile()
    }
    makeResign({player = null, setUndoPoint = true} = {}) {
        let {rootTree, currentPlayer} = this.inferredState
        if (player == null) player = currentPlayer
        let color = player > 0 ? 'W' : 'B'
        let rootNode = rootTree.nodes[0]

        if (setUndoPoint) this.setUndoPoint('Undo Resignation')
        rootNode.RE = [`${color}+Resign`]

        this.makeMove([-1, -1], {player, clearUndoPoint: false})
        this.makeMainVariation(...this.state.treePosition, {setUndoPoint: false})

        this.events.emit('resign', {player})
        
        this.endgame(player)
        
        
    }
    
    handleadv_postoprow(err,result,fei){
      //  console.log(result[0].loser)
        let pos=[]
        var res=[]
        for (var k = 0, length = result.length; k < length; k++)
        {
            if(result[k].loser<0){
           // console.log(result[k].x)
           // console.log(result[k].y)
              pos.push((result[k].x).toString()+','+(result[k].y).toString())                                     
            }         
            
        }
       // console.log(pos)
        window.sabaki.sortArray(pos)
       // console.log(pos)
        for (var o = 0; o < pos.length;) {  
               var count = 1;  
               for (var j = o+1; j < pos.length; j++){  
                  if (pos[o] == pos[j]) {  
                       count++;  
                   }  
                }
                // object:when it's visited,we should use res.num or res.position 
                // res.push({
                    // position:pos[o], 
                    // num:count  
                // } ); 
                res.push([pos[o],count])                             
                o+= count;  
        }
         // console.log(res);           
        window.sabaki.sortArrayByItem(res,1)
        console.log(res); 
        var start='0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
        if (res.length<10) {
            for (var p=res.length;p<10;p++) {
                res[p] = []
                res[p][0]=''
                res[p][1]=0
            }
        }
        var  addSql = 'INSERT INTO mode(modes,adv1,adv2,adv3,adv4,adv5,adv6,adv7,adv8,adv9,adv10,fre1,fre2,fre3,fre4,fre5,fre6,fre7,fre8,fre9,fre10) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
        var  addSqlParams = [start,res[0][0],res[1][0],res[2][0],res[3][0],res[4][0],res[5][0],res[6][0],res[7][0],res[8][0],res[9][0],res[0][1],res[1][1],res[2][1],res[3][1],res[4][1],res[5][1],res[6][1],res[7][1],res[8][1],res[9][1]];
      //  var  addSql = 'INSERT INTO mode(modes,adv1,adv2,adv3,fre1,fre2,fre3) VALUES(?,?,?,?,?,?,?)';
      //  var  addSqlParams = [start,res[0][0],res[1][0],res[2][0],res[0][1],res[1][1],res[2][1]];
        query(addSql,addSqlParams,function (err, result) {
            if(err){
             console.log('[INSERT ERROR] - ',err.message);
             return;
            }        
       });
    }
    handleadv_pos(err,result,fei){
      //  console.log(result[0].loser)
      let apos=[]
      var amodes=[]
      var aremodes=[]
      //console.log(result[0].x)
      //console.log(result[0].y)
      for (var ak = 0, alength = result.length; ak < alength; ak++){ 
         
         if(result[ak].GID == 168 && result[ak].SID == 1)
             console.log(result[ak])
         if(result[ak].loser*result[ak].class<0){
            console.log(result[ak].GID)
            console.log(result[ak].SID)
            amodes.push(result[ak].boards)
            
            apos.push((result[ak].x).toString()+','+(result[ak].y).toString())                     
         }
      }
      for (var o = 0; o < amodes.length;) {  
               var start=o;
               var count = 1;  
               for (var j = o+1; j < amodes.length; j++){  
                  if (amodes[o] == amodes[j]) {  
                       count++;  
                   }  
                }
                // object:when it's visited,we should use res.num or res.position 
                // res.push({
                    // position:pos[o], 
                    // num:count  
                // } ); 
                aremodes.push([amodes[o],o,count])                             
                o+= count;  
        }  
     // console.log(apos)
      //console.log(amodes)  
     // console.log(aremodes)
      for (var p = 0; p < aremodes.length;p++){
          var ares=[]
          var tmp=[]
          for (var q =aremodes[p][1]; q < aremodes[p][1]+aremodes[p][2];q++){
              tmp.push(apos[q])
           }
          //console.log(tmp)
          window.sabaki.sortArray(tmp)
          for (var r = 0; r < tmp.length;) {  
               var count = 1;  
               for (var s = r+1; s < tmp.length; s++){  
                  if (tmp[r] == tmp[s]) {  
                       count++;  
                   }  
                }
                // object:when it's visited,we should use res.num or res.position 
                // res.push({
                    // position:pos[o], 
                    // num:count  
                // } ); 
                ares.push([tmp[r],count])                             
                r+= count;  
            }           
                     // console.log(res);           
          window.sabaki.sortArrayByItem(ares,1)
          //console.log(ares); 
        
            for (var t=ares.length;t<10;t++) {
                ares[t] = []
                ares[t][0]=''
                ares[t][1]=0
            }
        
            var  addSql2 = 'INSERT INTO mode(modes,adv1,adv2,adv3,adv4,adv5,adv6,adv7,adv8,adv9,adv10,fre1,fre2,fre3,fre4,fre5,fre6,fre7,fre8,fre9,fre10) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
            var  addSqlParams2 = [aremodes[p][0],ares[0][0],ares[1][0],ares[2][0],ares[3][0],ares[4][0],ares[5][0],ares[6][0],ares[7][0],ares[8][0],ares[9][0],ares[0][1],ares[1][1],ares[2][1],ares[3][1],ares[4][1],ares[5][1],ares[6][1],ares[7][1],ares[8][1],ares[9][1]];
          //  var  addSql = 'INSERT INTO mode(modes,adv1,adv2,adv3,fre1,fre2,fre3) VALUES(?,?,?,?,?,?,?)';
          //  var  addSqlParams = [start,ares[0][0],ares[1][0],ares[2][0],ares[0][1],ares[1][1],ares[2][1]];
            query(addSql2,addSqlParams2,function (err, result) {
                if(err){
                 console.log('[INSERT ERROR] - ',err.message);
                 return;
                }        
           });

        }
        console.log('handleadv_pos end')
    }
   
    sortArray(array){  
        for (var i = 0; i < array.length - 1; i++) {  
            for (var j = i + 1; j < array.length; j++) {  
                if (array[i]< array[j]) {  
                    var tmp = array[i];  
                    array[i] = array[j];  
                    array[j] = tmp;  
                }  
            }  
        }  
        return array;  
    }  
    sortArrayByItem(array, item) {  
        for (var i = 0; i < array.length - 1; i++) {  
            for (var j = i + 1; j < array.length; j++) {  
                if (array[i][item] < array[j][item]) {  
                    var tmp = array[i];  
                    array[i] = array[j];  
                    array[j] = tmp;  
                }  
            }  
        }  
        return array;  
    }  

    generateMode() {
        var adv_postoprow = 'SELECT game.GID,loser,x,y,class,numArea,steps FROM factor,game WHERE factor.SID=1 AND factor.GID=game.GID';
        //查
        query(adv_postoprow,'',this.handleadv_postoprow);
        var adv_pos = 'SELECT state_board.GID,state_board.SID,state_board.boards,game.loser,factor.x,factor.y,factor.class,numArea,steps FROM factor,game,state_board WHERE factor.GID=state_board.GID AND factor.SID=state_board.SID+1 AND game.GID=state_board.GID and boards NOT IN (select modes from mode) ORDER BY  boards asc'
        query(adv_pos,'',this.handleadv_pos);
       
       
       
    }

    useTool(tool, vertex, argument = null) {
        let [tree, index] = this.state.treePosition
        let {currentPlayer, gameIndex} = this.inferredState
        let board = gametree.getBoard(tree, index)
        let node = tree.nodes[index]

        if (typeof vertex == 'string') {
            vertex = board.coord2vertex(vertex)
        }

        let data = {
            cross: 'MA',
            triangle: 'TR',
            circle: 'CR',
            square: 'SQ',
            number: 'LB',
            label: 'LB'
        }

        if (['stone_-1', 'stone_1'].includes(tool)) {
            if ('B' in node || 'W' in node || gametree.navigate(tree, index, 1)) {
                // New variation needed

                let updateRoot = tree.parent == null
                let splitted = gametree.split(tree, index)

                if (splitted != tree || splitted.subtrees.length != 0) {
                    tree = gametree.new()
                    tree.parent = splitted
                    splitted.subtrees.push(tree)
                }

                node = {PL: currentPlayer > 0 ? ['B'] : ['W']}
                index = tree.nodes.length
                tree.nodes.push(node)

                if (updateRoot) {
                    let {gameTrees} = this.state
                    gameTrees[gameIndex] = splitted
                }
            }

            let sign = tool === 'stone_1' ? 1 : -1
            let oldSign = board.get(vertex)
            let properties = ['AW', 'AE', 'AB']
            let point = sgf.vertex2point(vertex)

            for (let prop of properties) {
                if (!(prop in node)) continue

                // Resolve compressed lists

                if (node[prop].some(x => x.includes(':'))) {
                    node[prop] = node[prop]
                        .map(value => sgf.compressed2list(value).map(sgf.vertex2point))
                        .reduce((list, x) => [...list, x])
                }

                // Remove residue

                node[prop] = node[prop].filter(x => x !== point)
                if (node[prop].length === 0) delete node[prop]
            }

            let prop = oldSign !== sign ? properties[sign + 1] : 'AE'

            if (prop in node) node[prop].push(point)
            else node[prop] = [point]
        } else if (['line', 'arrow'].includes(tool)) {
            let endVertex = argument

            if (!endVertex || helper.vertexEquals(vertex, endVertex)) return

            // Check whether to remove a line

            let toDelete = board.lines.findIndex(x => helper.equals(x.slice(0, 2), [vertex, endVertex]))

            if (toDelete === -1) {
                toDelete = board.lines.findIndex(x => helper.equals(x.slice(0, 2), [endVertex, vertex]))

                if (toDelete >= 0 && tool !== 'line' && board.lines[toDelete][2]) {
                    // Do not delete after all
                    toDelete = -1
                }
            }

            // Mutate board first, then apply changes to actual game tree

            if (toDelete >= 0) {
                board.lines.splice(toDelete, 1)
            } else {
                board.lines.push([vertex, endVertex, tool === 'arrow'])
            }

            node.LN = []
            node.AR = []

            for (let [v1, v2, arrow] of board.lines) {
                let [p1, p2] = [v1, v2].map(sgf.vertex2point)
                if (p1 === p2) continue

                node[arrow ? 'AR' : 'LN'].push([p1, p2].join(':'))
            }

            if (node.LN.length === 0) delete node.LN
            if (node.AR.length === 0) delete node.AR
        } else {
            // Mutate board first, then apply changes to actual game tree

            if (tool === 'number') {
                if (vertex in board.markups && board.markups[vertex][0] === 'label') {
                    delete board.markups[vertex]
                } else {
                    let number = !node.LB ? 1 : node.LB
                        .map(x => parseFloat(x.substr(3)))
                        .filter(x => !isNaN(x))
                        .sort((a, b) => a - b)
                        .filter((x, i, arr) => i === 0 || x !== arr[i - 1])
                        .concat([null])
                        .findIndex((x, i) => i + 1 !== x) + 1

                    argument = number.toString()
                    board.markups[vertex] = [tool, number.toString()]
                }
            } else if (tool === 'label') {
                let label = argument

                if (label != null && label.trim() === ''
                || label == null && vertex in board.markups && board.markups[vertex][0] === 'label') {
                    delete board.markups[vertex]
                } else {
                    if (label == null) {
                        let alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                        let letterIndex = Math.max(
                            !node.LB ? 0 : node.LB
                                .filter(x => x.length === 4)
                                .map(x => alpha.indexOf(x[3]))
                                .filter(x => x >= 0)
                                .sort((a, b) => a - b)
                                .filter((x, i, arr) => i === 0 || x !== arr[i - 1])
                                .concat([null])
                                .findIndex((x, i) => i !== x),
                            !node.L ? 0 : node.L.length
                        )

                        label = alpha[Math.min(letterIndex, alpha.length - 1)]
                        argument = label
                    }

                    board.markups[vertex] = [tool, label]
                }
            } else {
                if (vertex in board.markups && board.markups[vertex][0] === tool) {
                    delete board.markups[vertex]
                } else {
                    board.markups[vertex] = [tool, '']
                }
            }

            delete node.L
            for (let id in data) delete node[data[id]]

            // Now apply changes to game tree

            for (let x = 0; x < board.width; x++) {
                for (let y = 0; y < board.height; y++) {
                    let v = [x, y]
                    if (!(v in board.markups)) continue

                    let prop = data[board.markups[v][0]]
                    let value = sgf.vertex2point(v)

                    if (prop === 'LB')
                        value += ':' + board.markups[v][1]

                    if (prop in node) node[prop].push(value)
                    else node[prop] = [value]
                }
            }
        }

        this.clearUndoPoint()
        this.setCurrentTreePosition(tree, index)

        this.events.emit('toolUse', {tool, vertex, argument})
    }

    // Undo Methods

    setUndoPoint(undoText = 'Undo') {
        let {treePosition: [tree, index]} = this.state
        let rootTree = gametree.clone(gametree.getRoot(tree))
        let level = gametree.getLevel(tree, index)

        this.undoData = [rootTree, level]
        this.setState({undoable: true, undoText})
    }

    clearUndoPoint() {
        this.undoData = null
        this.setState({undoable: false})
    }

    undo() {
        if (!this.state.undoable || !this.undoData) return

        this.setBusy(true)

        setTimeout(() => {
            let [undoRoot, undoLevel] = this.undoData
            let {treePosition, gameTrees} = this.state

            gameTrees[this.inferredState.gameIndex] = undoRoot
            treePosition = gametree.navigate(undoRoot, 0, undoLevel)

            this.setCurrentTreePosition(...treePosition)
            this.clearUndoPoint()
            this.setBusy(false)
        }, setting.get('edit.undo_delay'))
    }

    // Navigation

    setCurrentTreePosition(tree, index, {clearUndoPoint = true} = {}) {
        if (['scoring', 'estimator'].includes(this.state.mode))
            return

        let t = tree
        while (t.parent != null) {
            t.parent.current = t.parent.subtrees.indexOf(t)
            t = t.parent
        }

        if (clearUndoPoint && t !== gametree.getRoot(this.state.treePosition[0])) {
            this.clearUndoPoint()
        }

        this.setState({
            blockedGuesses: [],
            highlightVertices: [],
            treePosition: [tree, index]
        })

        this.events.emit('navigate')
    }

    goStep(step) {
        let treePosition = gametree.navigate(...this.state.treePosition, step)
        if (treePosition) this.setCurrentTreePosition(...treePosition)
    }

    goToMoveNumber(number) {
        number = +number

        if (isNaN(number)) return
        if (number < 0) number = 0

        let {treePosition} = this.state
        let root = gametree.getRoot(...treePosition)

        treePosition = gametree.navigate(root, 0, Math.round(number))

        if (treePosition) this.setCurrentTreePosition(...treePosition)
        else this.goToEnd()
    }

    goToNextFork() {
        let [tree, index] = this.state.treePosition

        if (index !== tree.nodes.length - 1) {
            this.setCurrentTreePosition(tree, tree.nodes.length - 1)
        } else if (tree.subtrees.length !== 0) {
            let subtree = tree.subtrees[tree.current]
            this.setCurrentTreePosition(subtree, subtree.nodes.length - 1)
        }
    }

    goToPreviousFork() {
        let [tree, index] = this.state.treePosition

        if (tree.parent == null || tree.parent.nodes.length === 0) {
            if (index != 0) this.setCurrentTreePosition(tree, 0)
        } else {
            this.setCurrentTreePosition(tree.parent, tree.parent.nodes.length - 1)
        }
    }

    goToComment(step) {
        let tp = this.state.treePosition

        while (true) {
            tp = gametree.navigate(...tp, step)
            if (!tp) break

            let node = tp[0].nodes[tp[1]]

            if (setting.get('sgf.comment_properties').some(p => p in node))
                break
        }

        if (tp) this.setCurrentTreePosition(...tp)
    }

    goToBeginning() {
        this.setCurrentTreePosition(gametree.getRoot(...this.state.treePosition), 0)
    }

    goToEnd() {
        let rootTree = gametree.getRoot(...this.state.treePosition)
        let tp = gametree.navigate(rootTree, 0, gametree.getCurrentHeight(rootTree) - 1)
        this.setCurrentTreePosition(...tp)
    }

    goToSiblingVariation(step) {
        let [tree, index] = this.state.treePosition
        if (!tree.parent) return

        step = step < 0 ? -1 : 1

        let mod = tree.parent.subtrees.length
        let i = (tree.parent.current + mod + step) % mod

        this.setCurrentTreePosition(tree.parent.subtrees[i], 0)
    }

    goToMainVariation() {
        let tp = this.state.treePosition
        let root = gametree.getRoot(...tp)

        while (root.subtrees.length !== 0) {
            root.current = 0
            root = root.subtrees[0]
        }

        if (gametree.onMainTrack(...tp)) {
            this.setCurrentTreePosition(...tp)
        } else {
            let [tree] = tp

            while (!gametree.onMainTrack(tree)) {
                tree = tree.parent
            }

            this.setCurrentTreePosition(tree, tree.nodes.length - 1)
        }
    }

    goToSiblingGame(step) {
        let {gameTrees, treePosition} = this.state
        let [tree, ] = treePosition
        let index = gameTrees.indexOf(gametree.getRoot(tree))
        let newIndex = Math.max(0, Math.min(gameTrees.length - 1, index + step))

        this.setCurrentTreePosition(gameTrees[newIndex], 0)
    }

    // Find Methods

    findPosition(step, condition, callback = helper.noop) {
        if (isNaN(step)) step = 1
        else step = step >= 0 ? 1 : -1

        this.setBusy(true)

        setTimeout(() => {
            let tp = this.state.treePosition
            let iterator = gametree.makeHorizontalNavigator(...tp)

            while (true) {
                tp = step >= 0 ? iterator.next() : iterator.prev()

                if (!tp) {
                    let root = this.inferredState.rootTree

                    if (step === 1) {
                        tp = [root, 0]
                    } else {
                        let sections = gametree.getSection(root, gametree.getHeight(root) - 1)
                        tp = sections[sections.length - 1]
                    }

                    iterator = gametree.makeHorizontalNavigator(...tp)
                }

                if (helper.vertexEquals(tp, this.state.treePosition) || condition(...tp))
                    break
            }

            this.setCurrentTreePosition(...tp)
            this.setBusy(false)
            callback()
        }, setting.get('find.delay'))
    }

    findHotspot(step, callback = helper.noop) {
        this.findPosition(step, (tree, index) => 'HO' in tree.nodes[index], callback)
    }

    findMove(step, {vertex = null, text = ''}, callback = helper.noop) {
        if (vertex == null && text.trim() === '') return
        let point = vertex ? sgf.vertex2point(vertex) : null

        this.findPosition(step, (tree, index) => {
            let node = tree.nodes[index]
            let cond = (prop, value) => prop in node
                && node[prop][0].toLowerCase().includes(value.toLowerCase())

            return (!point || ['B', 'W'].some(x => cond(x, point)))
                && (!text || cond('C', text) || cond('N', text))
        }, callback)
    }

    // Node Actions

    getGameInfo(tree) {
        let root = gametree.getRoot(tree)

        let komi = gametree.getRootProperty(root, 'KM')
        if (komi != null && !isNaN(komi)) komi = +komi
        else komi = null

        let size = gametree.getRootProperty(root, 'SZ')
        if (size == null) {
            size = [19, 19]
        } else {
            let s = size.toString().split(':')
            size = [+s[0], +s[s.length - 1]]
        }

        let handicap = ~~gametree.getRootProperty(root, 'HA', 0)
        handicap = Math.max(1, Math.min(9, handicap))
        if (handicap === 1) handicap = 0

        let playerNames = ['B', 'W'].map(x =>
            gametree.getRootProperty(tree, `P${x}`) || gametree.getRootProperty(tree, `${x}T`)
        )

        let playerRanks = ['BR', 'WR'].map(x => gametree.getRootProperty(root, x))

        return {
            playerNames,
            playerRanks,
            blackName: playerNames[0],
            blackRank: playerRanks[0],
            whiteName: playerNames[1],
            whiteRank: playerRanks[1],
            gameName: gametree.getRootProperty(root, 'GN'),
            eventName: gametree.getRootProperty(root, 'EV'),
            date: gametree.getRootProperty(root, 'DT'),
            result: gametree.getRootProperty(root, 'RE'),
            komi,
            handicap,
            size
        }
    }

    setGameInfo(tree, data) {
        let root = gametree.getRoot(tree)
        let node = root.nodes[0]
        console.log(data)
        if ('size' in data) {
            // Update board size

            if (data.size) {
                let value = data.size
                value = value.map((x, i) => isNaN(x) || !x ? 19 : Math.min(25, Math.max(3, x)))

                if (value[0] === value[1]) value = value[0]
                else value = value.join(':')

                setting.set('game.default_board_size', value)
                node.SZ = [value]
            } else {
                delete node.SZ
            }
        }

        let props = {
            blackName: 'PB',
            blackRank: 'BR',
            whiteName: 'PW',
            whiteRank: 'WR',
            gameName: 'GN',
            eventName: 'EV',
            date: 'DT',
            result: 'RE',
            komi: 'KM',
            handicap: 'HA'
        }
        for (let key in props) {
            console.log(key)
            if (!(key in data)) continue

            let value = data[key]
            console.log(value)
            if (value && value.toString().trim() !== '') {
                console.log(key)
                if (key === 'komi') {
                    if (isNaN(value)) value = 0

                    setting.set('game.default_komi', value)
                } else if (key === 'handicap') {
                    let board = gametree.getBoard(root, 0)
                    let stones = board.getHandicapPlacement(+value)

                    value = stones.length
                    setting.set('game.default_handicap', value)

                    if (value <= 1) {
                        delete node[props[key]]
                        delete node.AB
                        continue
                    }

                    node.AB = stones.map(sgf.vertex2point)
                }

                node[props[key]] = [value]
            } else {
                delete node[props[key]]
            }
        }
    }

    getPlayer(tree, index) {
        let node = tree.nodes[index]

        return 'PL' in node ? (node.PL[0] == 'W' ? -1 : 1)
            : 'B' in node || 'HA' in node && +node.HA[0] >= 1 ? -1
            : 1
    }

    setPlayer(tree, index, sign) {
        let node = tree.nodes[index]
        let intendedSign = 'B' in node || 'HA' in node && +node.HA[0] >= 1 ? -1 : +('W' in node)

        if (intendedSign === sign || sign === 0) {
            delete node.PL
        } else {
            node.PL = [sign > 0 ? 'B' : 'W']
        }

        this.clearUndoPoint()
    }

    getComment(tree, index) {
        let node = tree.nodes[index]

        return {
            title: 'N' in node ? node.N[0].trim() : null,
            comment: 'C' in node ? node.C[0] : null,
            hotspot: 'HO' in node,
            moveAnnotation: 'BM' in node ? 'BM'
                : 'TE' in node ? 'TE'
                : 'DO' in node ? 'DO'
                : 'IT' in node ? 'IT'
                : null,
            positionAnnotation: 'UC' in node ? 'UC'
                : 'GW' in node ? 'GW'
                : 'DM' in node ? 'DM'
                : 'GB' in node ? 'GB'
                : null
        }
    }

    setComment(tree, index, data) {
        let node = tree.nodes[index]

        for (let [key, prop] of [['title', 'N'], ['comment', 'C']]) {
            if (key in data) {
                if (data[key] && data[key].trim() !== '') node[prop] = [data[key]]
                else delete node[prop]
            }
        }

        if ('hotspot' in data) {
            if (data.hotspot) node.HO = [1]
            else delete node.HO
        }

        let clearProperties = properties => properties.forEach(p => delete node[p])

        if ('moveAnnotation' in data) {
            let moveProps = {'BM': 1, 'DO': '', 'IT': '', 'TE': 1}

            clearProperties(Object.keys(moveProps))

            if (data.moveAnnotation != null)
                node[data.moveAnnotation] = [moveProps[data.moveAnnotation]]
        }

        if ('positionAnnotation' in data) {
            let positionProps = {'UC': 1, 'GW': 1, 'GB': 1, 'DM': 1}

            clearProperties(Object.keys(positionProps))

            if (data.positionAnnotation != null)
                node[data.positionAnnotation] = [positionProps[data.positionAnnotation]]
        }

        this.clearUndoPoint()
    }

    copyVariation(tree, index) {
        let clone = gametree.clone(tree)
        if (index != 0) gametree.split(clone, index - 1)

        this.copyVariationData = clone
    }

    cutVariation(tree, index, {setUndoPoint = true} = {}) {
        if (setUndoPoint) this.setUndoPoint('Undo Cut Variation')

        this.copyVariation(tree, index)
        this.removeNode(tree, index, {
            suppressConfirmation: true,
            setUndoPoint: false
        })
    }

    pasteVariation(tree, index, {setUndoPoint = true} = {}) {
        if (this.copyVariationData == null) return

        if (setUndoPoint) this.setUndoPoint('Undo Paste Variation')
        this.closeDrawer()
        this.setMode('play')

        let updateRoot = !tree.parent
        let oldLength = tree.nodes.length
        let splitted = gametree.split(tree, index)
        let copied = gametree.clone(this.copyVariationData)

        copied.parent = splitted
        splitted.subtrees.push(copied)

        if (updateRoot) {
            let {gameTrees} = this.state
            gameTrees[this.inferredState.gameIndex] = splitted
            this.setState({gameTrees})
        }

        if (splitted.subtrees.length === 1) {
            gametree.reduce(splitted)
            this.setCurrentTreePosition(splitted, oldLength)
        } else {
            this.setCurrentTreePosition(copied, 0)
        }
    }

    flattenVariation(tree, index, {setUndoPoint = true} = {}) {
        if (setUndoPoint) this.setUndoPoint('Undo Flatten')
        this.closeDrawer()
        this.setMode('play')

        let {gameTrees} = this.state
        let {rootTree, gameIndex} = this.inferredState
        let board = gametree.getBoard(tree, index)
        let rootNode = rootTree.nodes[0]
        let inherit = ['BR', 'BT', 'DT', 'EV', 'GN', 'GC', 'PB', 'PW', 'RE', 'SO', 'WT', 'WR']

        let clone = gametree.clone(tree)
        if (index !== 0) gametree.split(clone, index - 1)
        let node = clone.nodes[0]

        node.AB = []
        node.AW = []
        delete node.AE
        delete node.B
        delete node.W

        clone.parent = null
        inherit.forEach(x => x in rootNode ? node[x] = rootNode[x] : null)

        for (let x = 0; x < board.width; x++) {
            for (let y = 0; y < board.height; y++) {
                let sign = board.get([x, y])
                if (sign == 0) continue

                node[sign > 0 ? 'AB' : 'AW'].push(sgf.vertex2point([x, y]))
            }
        }

        if (node.AB.length === 0) delete node.AB
        if (node.AW.length === 0) delete node.AW

        gameTrees[gameIndex] = clone
        this.setState({gameTrees})
        this.setCurrentTreePosition(clone, 0, {clearUndoPoint: false})
    }

    makeMainVariation(tree, index, {setUndoPoint = true} = {}) {
        if (setUndoPoint) this.setUndoPoint('Restore Main Variation')
        this.closeDrawer()
        this.setMode('play')

        let t = tree

        while (t.parent != null) {
            t.parent.subtrees.splice(t.parent.subtrees.indexOf(t), 1)
            t.parent.subtrees.unshift(t)
            t.parent.current = 0

            t = t.parent
        }

        t = tree

        while (t.subtrees.length !== 0) {
            let [x] = t.subtrees.splice(t.current, 1)
            t.subtrees.unshift(x)
            t.current = 0

            t = x
        }

        this.setCurrentTreePosition(tree, index)
    }

    shiftVariation(tree, index, step, {setUndoPoint = true} = {}) {
        if (!tree.parent) return

        if (setUndoPoint) this.setUndoPoint('Undo Shift Variation')
        this.closeDrawer()
        this.setMode('play')

        let subtrees = tree.parent.subtrees
        let m = subtrees.length
        let i = subtrees.indexOf(tree)
        let iNew = ((i + step) % m + m) % m

        subtrees.splice(i, 1)
        subtrees.splice(iNew, 0, tree)

        this.setCurrentTreePosition(...this.state.treePosition)
    }

    removeNode(tree, index, {suppressConfirmation = false, setUndoPoint = true} = {}) {
        if (!tree.parent && index === 0) {
            dialog.showMessageBox('主节点不能删除.', 'warning')
            return
        }

        if (suppressConfirmation !== true
        && setting.get('edit.show_removenode_warning')
        && dialog.showMessageBox(
            '是否删除这个子?',
            'warning',
            ['删除子', '取消'], 1
        ) === 1) return

        if (setUndoPoint) this.setUndoPoint('Undo Remove Node')
        this.closeDrawer()
        this.setMode('play')

        // Remove node

        let prev = gametree.navigate(tree, index, -1)

        if (index !== 0) {
            tree.nodes.splice(index, tree.nodes.length)
            tree.current = null
            tree.subtrees.length = 0
        } else {
            let parent = tree.parent
            let i = parent.subtrees.indexOf(tree)

            parent.subtrees.splice(i, 1)
            if (parent.current >= 1) parent.current--
            gametree.reduce(parent)
        }

        if (!prev) prev = this.state.treePosition
        this.setCurrentTreePosition(...prev)
    }

    removeOtherVariations(tree, index, {suppressConfirmation = false, setUndoPoint = true} = {}) {
        if (suppressConfirmation !== true
        && setting.get('edit.show_removeothervariations_warning')
        && dialog.showMessageBox(
            'Do you really want to remove all other variations?',
            'warning',
            ['Remove Variations', 'Cancel'], 1
        ) == 1) return

        // Save undo information

        if (setUndoPoint) this.setUndoPoint('Undo Remove Other Variations')
        this.closeDrawer()
        this.setMode('play')

        // Remove all subsequent variations

        let t = tree

        while (t.subtrees.length != 0) {
            t.subtrees = [t.subtrees[t.current]]
            t.current = 0

            t = t.subtrees[0]
        }

        // Remove all precedent variations

        t = tree

        while (t.parent != null) {
            t.parent.subtrees = [t]
            t.parent.current = 0

            t = t.parent
        }

        this.setCurrentTreePosition(tree, index)
    }

    // Menus

    openNodeMenu(tree, index, options = {}) {
        if (this.state.mode === 'scoring') return

        let template = [
            {
                label: 'C&opy Variation',
                click: () => this.copyVariation(tree, index)
            },
            {
                label: 'C&ut Variation',
                click: () => this.cutVariation(tree, index)
            },
            {
                label: '&Paste Variation',
                click: () => this.pasteVariation(tree, index)
            },
            {type: 'separator'},
            {
                label: 'Make &Main Variation',
                click: () => this.makeMainVariation(tree, index)
            },
            {
                label: "Shift &Left",
                click: () => this.shiftVariation(tree, index, -1)
            },
            {
                label: "Shift Ri&ght",
                click: () => this.shiftVariation(tree, index, 1)
            },
            {type: 'separator'},
            {
                label: '&Flatten',
                click: () => this.flattenVariation(tree, index)
            },
            {
                label: '&Remove Node',
                click: () => this.removeNode(tree, index)
            },
            {
                label: 'Remove &Other Variations',
                click: () => this.removeOtherVariations(tree, index)
            }
        ]

        helper.popupMenu(template, options.x, options.y)
    }

    openCommentMenu(tree, index, options = {}) {
        let node = tree.nodes[index]

        let template = [
            {
                label: '&Clear Annotations',
                click: () => {
                    this.setComment(tree, index, {positionAnnotation: null, moveAnnotation: null})
                }
            },
            {type: 'separator'},
            {
                label: 'Good for &Black',
                type: 'checkbox',
                data: {positionAnnotation: 'GB'}
            },
            {
                label: '&Unclear Position',
                type: 'checkbox',
                data: {positionAnnotation: 'UC'}
            },
            {
                label: '&Even Position',
                type: 'checkbox',
                data: {positionAnnotation: 'DM'}
            },
            {
                label: 'Good for &White',
                type: 'checkbox',
                data: {positionAnnotation: 'GW'}
            }
        ]

        if ('B' in node || 'W' in node) {
            template.push(
                {type: 'separator'},
                {
                    label: '&Good Move',
                    type: 'checkbox',
                    data: {moveAnnotation: 'TE'}
                },
                {
                    label: '&Interesting Move',
                    type: 'checkbox',
                    data: {moveAnnotation: 'IT'}
                },
                {
                    label: '&Doubtful Move',
                    type: 'checkbox',
                    data: {moveAnnotation: 'DO'}
                },
                {
                    label: 'B&ad Move',
                    type: 'checkbox',
                    data: {moveAnnotation: 'BM'}
                }
            )
        }

        template.push(
            {type: 'separator'},
            {
                label: '&Hotspot',
                type: 'checkbox',
                data: {hotspot: true}
            }
        )

        for (let item of template) {
            if (!('data' in item)) continue

            let [key] = Object.keys(item.data)
            let prop = key === 'hotspot' ? 'HO' : item.data[key]

            item.checked = prop in node
            if (item.checked) item.data[key] = null

            item.click = () => this.setComment(tree, index, item.data)
        }

        helper.popupMenu(template, options.x, options.y)
    }

    // GTP Engines

    attachEngines(...engines) {
        let {engineCommands, attachedEngines} = this.state
		console.log(engines)

        if (helper.vertexEquals([...engines].reverse(), attachedEngines)) {
            // Just swap engines

            this.attachedEngineControllers.reverse()
            this.engineBoards.reverse()

            this.setState({
                engineCommands: engineCommands.reverse(),
                attachedEngines: engines
            })

            return
        }

        let command = name => new gtp.Command(null, name)

        for (let i = 0; i < attachedEngines.length; i++) {
            if (attachedEngines[i] != engines[i]) {
                if (this.attachedEngineControllers[i]) this.attachedEngineControllers[i].stop()

                try {
                    let controller = engines[i] ? new gtp.Controller(engines[i]) : null
                    this.attachedEngineControllers[i] = controller
                    this.engineBoards[i] = null

                    this.sendGTPCommand(controller, command('name'))
                    this.sendGTPCommand(controller, command('version'))
                    this.sendGTPCommand(controller, command('protocol_version'))
                    this.sendGTPCommand(controller, command('list_commands'), ({response}) => {
                        engineCommands[i] = response.content.split('\n')
                    })

                    controller.on('stderr', ({content}) => {
                        this.setState(({consoleLog}) => ({
                            consoleLog: [...consoleLog, [
                                i === 0 ? 1 : -1,
                                controller.name,
                                null,
                                new gtp.Response(null, content, false, true)
                            ]]
                        }))
                    })

                    this.setState({engineCommands})
                } catch (err) {
                    this.attachedEngineControllers[i] = null
                    engines[i] = null
                }
            }
        }

        this.setState({attachedEngines: engines})
        this.syncEngines()
    }

    detachEngines() {
        this.attachEngines(null, null)
    }

    suspendEngines() {
        for (let controller of this.attachedEngineControllers) {
            if (controller != null) controller.stop()
        }

        this.engineBoards = [null, null]
    }

    sendGTPCommand(controller, command, callback = helper.noop) {
        if (controller == null) return

        let sign = 1 - this.attachedEngineControllers.indexOf(controller) * 2
        if (sign > 1) sign = 0
        let entry = [sign, controller.name, command]
        let maxLength = setting.get('console.max_history_count')

        this.setState(({consoleLog}) => {
            let newLog = consoleLog.slice(Math.max(consoleLog.length - maxLength + 1, 0))
            newLog.push(entry)

            return {consoleLog: newLog}
        })

        controller.sendCommand(command, ({response}) => {
            this.setState(({consoleLog}) => {
                let index = consoleLog.indexOf(entry)
                if (index === -1) return {}

                let newLog = [...consoleLog]
                newLog[index] = [...entry, response]

                return {consoleLog: newLog}
            })

            callback({response, command})
        })
    }

    syncEngines({passPlayer = null} = {}) {
        if (this.attachedEngineControllers.every(x => x == null)) return

        let board = gametree.getBoard(...this.state.treePosition)
        let komi = gametree.getRootProperty(this.state.treePosition[0], 'KM', 0)

        if (!board.isSquare()) {
            dialog.showMessageBox('GTP engines don’t support non-square boards.', 'warning')
            return this.detachEngines()
        } else if (!board.isValid()) {
            dialog.showMessageBox('GTP engines don’t support invalid board positions.', 'warning')
            return this.detachEngines()
        }

        this.setBusy(true)

        for (let i = 0; i < this.attachedEngineControllers.length; i++) {
            if (this.attachedEngineControllers[i] == null) continue

            let synced = false
            let controller = this.attachedEngineControllers[i]

            if (this.engineBoards[i] != null && komi !== this.engineBoards[i].komi) {
                // Update komi

                this.sendGTPCommand(controller, new gtp.Command(null, 'komi', komi))
                this.engineBoards[i].komi = komi
            }

            if (this.engineBoards[i] != null
            && board.getPositionHash() !== this.engineBoards[i].getPositionHash()) {
                // Diff boards

                let diff = this.engineBoards[i].diff(board).filter(v => board.get(v) !== 0)

                if (diff.length === 1) {
                    let vertex = diff[0]
                    let sign = board.get(vertex)
                    console.log("makeMove")
                    let move = this.engineBoards[i].makeMove(sign, vertex)

                    if (move.getPositionHash() === board.getPositionHash()) {
                        // Incremental board update possible

                        let color = sign > 0 ? 'B' : 'W'
                        let point = board.vertex2coord(vertex)

                        this.sendGTPCommand(controller, new gtp.Command(null, 'play', color, point))
                        synced = true
                    }
                }
            } else if (this.engineBoards[i] != null) {
                synced = true
            }

            if (!synced) {
                // Replay

                this.sendGTPCommand(controller, new gtp.Command(null, 'boardsize', board.width))
                this.sendGTPCommand(controller, new gtp.Command(null, 'clear_board'))

                for (let x = 0; x < board.width; x++) {
                    for (let y = 0; y < board.height; y++) {
                        let vertex = [x, y]
                        let sign = board.get(vertex)
                        if (sign === 0) continue

                        let color = sign > 0 ? 'B' : 'W'
                        let point = board.vertex2coord(vertex)

                        this.sendGTPCommand(controller, new gtp.Command(null, 'play', color, point))
                    }
                }
            }

            // Send pass if required

            if (passPlayer != null) {
                let color = passPlayer > 0 ? 'B' : 'W'
                this.sendGTPCommand(controller, new gtp.Command(null, 'play', color, 'pass'))
            }

            // Update engine board state

            this.engineBoards[i] = board
            this.engineBoards[i].komi = komi
        }

        this.setBusy(false)
    }

    startGeneratingMoves({passPlayer = null, followUp = false} = {}) {
        this.closeDrawer()
        if (followUp && !this.state.generatingMoves) {
            this.hideInfoOverlay()
            this.setBusy(false)
            return
        } else if (!followUp) {
            this.setState({generatingMoves: true})
        }

        let {currentPlayer, rootTree} = this.inferredState
        let [color, opponent] = currentPlayer > 0 ? ['B', 'W'] : ['W', 'B']
        let [playerIndex, otherIndex] = currentPlayer > 0 ? [0, 1] : [1, 0]
        let playerController = this.attachedEngineControllers[playerIndex]
        let otherController = this.attachedEngineControllers[otherIndex]

        if (playerController == null) {
            if (otherController != null) {
                // Switch engines, so the attached engine can play

                let engines = [...this.state.attachedEngines].reverse()
                this.attachEngines(...engines)
                ;[playerController, otherController] = [otherController, playerController]
            } else {
                return
            }
        }

        if (!followUp && playerController != null && otherController != null) {
            this.flashInfoOverlay('按 Esc键取消计算')
        }

        this.syncEngines({passPlayer})
        this.setBusy(true)

        this.sendGTPCommand(playerController, new gtp.Command(null, 'genmove', color), ({response}) => {
            let sign = color === 'B' ? 1 : -1
            let vertex = [-1, -1]

            if (response.content.toLowerCase() !== 'pass') {
                vertex = gametree.getBoard(rootTree, 0).coord2vertex(response.content)
            }

            if (response.content.toLowerCase() === 'resign') {
                if(!this.state.autoplay)
                    dialog.showMessageBox(`${playerController.name}认输.`)

                this.stopGeneratingMoves()
                this.hideInfoOverlay()
                this.makeResign()

                return
            }
            console.log("makeMove")
            console.log(vertex)
            this.makeMove(vertex, {player: sign})
            //this.makeMove(vertex, {player: sign,sendToEngine: response.content.toLowerCase() === 'pass'})

            let komi = this.engineBoards[playerIndex] && this.engineBoards[playerIndex].komi
            this.engineBoards[playerIndex] = gametree.getBoard(...this.state.treePosition)
            this.engineBoards[playerIndex].komi = komi

            if (otherController != null && (!helper.vertexEquals(vertex, [-1, -1])||(response.content.toLowerCase() === 'pass' && this.state.autoplay))) {
                setTimeout(() => this.startGeneratingMoves({followUp: true}), setting.get('gtp.move_delay'))
            } else {
                this.stopGeneratingMoves()
                this.hideInfoOverlay()
                this.setBusy(false)
            }
        })
    }

    stopGeneratingMoves() {
        this.showInfoOverlay('Please wait…')
        this.setState({generatingMoves: false})
    }

    // Render

    render(_, state) {
        // Calculate some inferred values

        let rootTree = gametree.getRoot(...state.treePosition)
        let scoreBoard, areaMap

        if (['scoring', 'estimator'].includes(state.mode)) {
            // Calculate area map

            scoreBoard = gametree.getBoard(...state.treePosition).clone()
            console.log(state.deadStones)
            for (let vertex of state.deadStones) {
                let sign = scoreBoard.get(vertex)
                if (sign === 0) continue

                scoreBoard.captures[sign > 0 ? 1 : 0]++
                scoreBoard.set(vertex, 0)
            }

            areaMap = state.mode === 'estimator' ? scoreBoard.getAreaEstimateMap()
                : scoreBoard.getAreaMap()
        }

        this.inferredState = {
            showSidebar: state.showGameGraph || state.showCommentBox,
            showLeftSidebar: state.showConsole,
            rootTree,
            gameIndex: state.gameTrees.indexOf(rootTree),
            gameInfo: this.getGameInfo(rootTree),
            currentPlayer: this.getPlayer(...state.treePosition),
            scoreBoard,
            areaMap,
            autoplay:state.autoplay,
        }
        state = Object.assign(state, this.inferredState)

        return h('section',
            {
                class: classNames({
                    leftsidebar: state.showLeftSidebar,
                    sidebar: state.showSidebar,
                    [state.mode]: true
                })
            },

            h(ThemeManager),
            h(MainView, state),
            h(LeftSidebar, state),
            h(Sidebar, state),
            h(DrawerManager, state),

            h(InputBox, {
                text: state.inputBoxText,
                show: state.showInputBox,
                onSubmit: state.onInputBoxSubmit,
                onCancel: state.onInputBoxCancel
            }),

            h(BusyScreen, {show: state.busy}),
            h(InfoOverlay, {text: state.infoOverlayText, show: state.showInfoOverlay})
        )
    }
}

// Render

render(h(App), document.body)
