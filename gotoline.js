define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "settings", "ui",
        "anims", "menus", "commands", "util", "tabManager"
    ];
    main.provides = ["ace.gotoline"];
    return main;
    
    // @todo add commands for list navigation and bookmarking
    // @todo fix pasting of line numbers

    function main(options, imports, register) {
        var c9       = imports.c9;
        var Plugin   = imports.Plugin;
        var settings = imports.settings;
        var ui       = imports.ui;
        var anims    = imports.anims;
        var util     = imports.util;
        var menus    = imports.menus;
        var commands = imports.commands;
        var tabs     = imports.tabManager;
        
        var skin   = require("text!./skin.xml");
        var markup = require("text!./gotoline.xml");
        
        /***** Initialization *****/
        
        var deps   = main.consumes.slice(0, main.consumes.length - 1);
        var plugin = new Plugin("Ajax.org", deps);
        var emit   = plugin.getEmitter();
        
        var originalLine, originalColumn, control, lastLine, lineControl; 
        var nohide, originalPath;
        var win, input, list, model; // ui elements
        
        var loaded = false, changed = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            model = new ui.model();
            
            menus.addItemByPath("Goto/Goto Line...", new apf.item({
                caption : "Goto Line...",
                hint    : "enter a line number and jump to it in the active document",
                command : "gotoline"
            }), 200, plugin);
    
            commands.addCommand({
                name        : "gotoline",
                bindKey     : { mac: "Command-L", win: "Ctrl-G" },
                isAvailable : function(editor){
                    return editor && editor.type == "ace";
                },
                exec : function() {
                    gotoline();
                }
            }, plugin);
            
            commands.addCommand({
                bindKey     : { mac: "ESC", win: "ESC" },
                isAvailable : function(editor){ return win && win.visible; },
                exec        : function() {
                    hide();
                    var tab = tabs.focussedTab;
                    tab && tabs.focusTab(tab);
                    
                    if (originalLine) {
                        execGotoLine(originalLine, originalColumn, true);
                        originalPath = originalColumn = originalLine = undefined;
                    }
                }
            }, plugin);
            
            settings.on("read", function(){
                var lines = settings.getJson("user/gotoline") || [];
                var xml   = "";
                for (var i = 0, l = lines.length; i < l; i+=2) {
                    xml += "<line nr='" + lines[i] + "' path="
                        + util.escapeXpathString(lines[i+1]) 
                        + " />";
                }
                model.load("<lines>" + xml + "</lines>");
            });
            
            settings.on("write", function(){
                if (changed) {
                    var nodes = model.data.childNodes;
                    var lines = [];
                    for (var i = 0, l = Math.min(20, nodes.length); i < l; i++) {
                        lines.push(nodes[i].getAttribute("nr"), 
                            nodes[i].getAttribute("path"));
                    }
                    settings.setJson("user/gotoline", lines);
                }
            });
        }
        
        var drawn = false;
        function draw(){
            if (drawn) return;
            drawn = true;
            
            // Import Skin
            ui.insertSkin({
                name         : "gotoline",
                data         : skin,
                "media-path" : options.staticPrefix + "/images/"
            }, plugin);
            
            // Create UI elements
            ui.insertMarkup(null, markup, plugin);
            
            win   = plugin.getElement("window");
            input = plugin.getElement("input");
            list  = plugin.getElement("list");
            
            list.setAttribute("model", model);
            
            list.addEventListener("afterchoose", function() {
                if (list.selected) {
                    execGotoLine(parseInt(list.selected.getAttribute("nr"), 10));
                }
                else {
                    execGotoLine();
                }
            });
            list.addEventListener("afterselect", function() {
                if (!list.selected)
                    return;
    
                var path = list.selected.getAttribute("path");
                var line = list.selected.getAttribute("nr")
                input.setValue(line);
                tabs.open({path: path}, function(err, tab){
                    if (!err) {
                        nohide = true;
                        // Focus the tab
                        tabs.focusTab(tab);
                        
                        // Append window
                        attachToAce(tab.editor.ace);
                        
                        // Focus the list
                        list.focus();
                        nohide = false;
                        
                        // Go to the right line
                        execGotoLine(null, null, true);
                    }
                });
            });
    
            var restricted = [38, 40, 36, 35];
            list.addEventListener("keydown", function(e) {
                if (e.keyCode == 13 && list.selected){
                    return false;
                }
                else if (e.keyCode == 38) {
                    if (list.selected == list.getFirstTraverseNode()) {
                        input.focus();
                        list.clearSelection();
                    }
                }
                else if (restricted.indexOf(e.keyCode) == -1)
                    input.focus();
            }, true);
    
            input.addEventListener("keydown", function(e) {
                var NotANumber = (e.keyCode > 57 || e.keyCode == 32) 
                  && (e.keyCode < 96 || e.keyCode > 105);
                
                if (e.keyCode == 13){
                    execGotoLine();
                    return false;
                }
                else if (e.keyCode == 40) {
                    var first = list.getFirstTraverseNode();
                    if (first) {
                        list.select(first);
                        list.$container.scrollTop = 0;
                        list.focus();
                    }
                }
                else if (NotANumber && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    return false;
                }
                
                // Numbers & Cmd-V / Cmd-C
                if (!NotANumber || (e.metaKey || e.ctrlKey) 
                  && (e.keyCode == 86 || e.keyCode == 88)) {
                    setTimeout(function(){
                        execGotoLine(null, null, true);
                    }, 10);
                }
            });
    
            win.addEventListener("blur", function(e){
                if (!ui.isChildOf(win, e.toElement))
                    hide();
            });
    
            input.addEventListener("blur", function(e){
                if (!ui.isChildOf(win, e.toElement))
                    hide();
            });
            
            emit("draw");
        }
        
        function attachToAce(ace){
            ace.container.parentNode.appendChild(win.$ext);
            
            var theme  = ace.getTheme();
            var isDark = require(theme).isDark;
            
            win.setAttribute("class", isDark ? "ace_dark" : "");
        }
        
        /***** Methods *****/
        
         function show(noanim) {
            var tab    = tabs.focussedTab;
            var editor  = tab && tab.editor;
            if (!editor || editor.type != "ace") return;
            
            var ace     = editor.ace;
            var aceHtml = ace.container;
            var cursor  = ace.getCursorPosition();
    
            originalLine   = cursor.row + 1;
            originalColumn = cursor.column;
            originalPath   = tab.path;
    
            //Set the current line
            input.setValue(input.getValue() || cursor.row + 1);
    
            //Determine the position of the window
            var pos    = ace.renderer.textToScreenCoordinates(cursor.row, cursor.column);
            var epos   = ui.getAbsolutePosition(aceHtml.parentNode);
            var maxTop = aceHtml.offsetHeight - 100;
            var top    = Math.max(0, Math.min(maxTop, pos.pageY - epos[1] - 5));
            var left   = 0;
    
            attachToAce(ace);
    
            win.show();
            win.$ext.style.top = top + "px";
    
            //Animate
            if (!noanim && settings.getBool('user/general/@animateui')) {
                win.setWidth(0);
                
                anims.animate(win, {
                    width          : "60px",
                    duration       : 0.15,
                    timingFunction : "cubic-bezier(.11, .93, .84, 1)"
                }, function() {
                    win.$ext.style.left = left + "px";
                });
            }
            else {
                win.setWidth(60);
            }
            input.focus();
        }
    
        function hide() {
            if (nohide) return;
            
            if (settings.getBool('user/general/@animateui')) {
                anims.animate(win, {
                    width          : "0px",
                    duration       : 0.15,
                    timingFunction : "cubic-bezier(.10, .10, .25, .90)"
                }, function(){
                    win.hide();
                });
            }
            else {
                win.hide();
            }
        }
    
        function gotoline(force) {
            draw();
    
            if (control && control.stop)
                control.stop();
    
            var tab    = tabs.focussedTab;
            var editor = tab && tab.editor;
            if (!editor || editor.type != "ace")
                return;
    
            if (force != 2 && !win.visible || force == 1)
                show();
            else
                hide();
    
            return false;
        }
    
        function execGotoLine(line, column, preview) {
            var tab    = tabs.focussedTab && tabs.focussedTab;
            var editor  = tab && tab.editor;
            if (!editor || editor.type != "ace") return;
            
            var ace     = editor.ace;
            var aceHtml = ace.container;
            
            if (typeof line != "number")
                line = parseInt(input.getValue(), 10) || 0;
                
            if (!lastLine || lastLine != line || !ace.isRowFullyVisible(line)) {
                ace.gotoLine(line, column);
                lastLine = line;
            }
    
            if (typeof preview != "undefined") {
                var animate = settings.getBool("user/ace/@animatedScroll");
                if (!animate)
                    return;
    
                var cursor     = ace.getCursorPosition();
                var renderer   = ace.renderer;
                var fLine      = renderer.textToScreenCoordinates(0, 0).pageY;
                var pos        = renderer.textToScreenCoordinates(cursor.row, cursor.column);
                var half       = aceHtml.offsetHeight / 2; 
                var lineHeight = renderer.lineHeight;
                var totalLines = ace.getSession().getLength();
                var lLine      = renderer.textToScreenCoordinates(totalLines, 0).pageY + lineHeight;
                var maxTop     = aceHtml.offsetHeight - win.getHeight() - 10;
    
                var top;
                //First part of doc
                if (pos.pageY - fLine < half) {
                    top = Math.max(0, pos.pageY - fLine - 5);
                }
                //Last part of doc
                else if (lLine - pos.pageY < half) {
                    top = Math.min(maxTop, half + (half - (lLine - pos.pageY)));
                }
                //Already visible
                else if (ace.isRowFullyVisible(cursor.row)) {
                    //Determine the position of the window
                    var epos = ui.getAbsolutePosition(aceHtml);
                    top = Math.min(maxTop, pos.pageY - epos[1] - 5);
                }
                //General case (centered)
                else {
                    top = half - 1;// - lineHeight;
                }
    
                if (lineControl)
                    lineControl.stop();
    
                //Animate
                anims.animate(win, {
                    top            : top + "px",
                    duration       : 0.25,
                    timingFunction : "cubic-bezier(.11, .93, .84, 1)"
                }, function() {
                    win.$ext.style.left = "0px";
                });
            }
            else {
                //win.hide();
                hide();
    
                if (tabs.focussedTab.path) {
                    var lineNode = model.queryNode("line[@nr='" + line 
                        + "' and @path=" 
                        + util.escapeXpathString(tabs.focussedTab.path) + "]");
                    
                    if (!lineNode) {
                        lineNode = ui.n("<line />")
                            .attr("nr", line)
                            .attr("path", tabs.focussedTab.path)
                            .node();
                    }
        
                    var pNode = model.data;
                    if (lineNode != pNode.firstChild) {
                        apf.xmldb.appendChild(pNode, lineNode, pNode.firstChild);
                        changed = true;
                        settings.save();
                    }
                }

                tabs.focusTab(tab);
            }
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * The goto line dialog for ace editors. The goto line dialog allows
         * users to jump to a line in a file. It has a history of all lines
         * that were jumped to before. Users can navigate this list and press
         * ESC to return to their original position.
         * 
         * @singleton
         **/
        plugin.freezePublicAPI({
            /**
             * Jump to a line and column in the focussed tab.
             * @param {Number}  line     The line to jump to.
             * @param {Number}  column   The column to jump to.
             * @param {Boolean} preview  Whether to keep the original location in memory.
             */
            gotoline : function(line, column, preview){
                gotoline(1);
                return execGotoLine(line, column, preview);
            },
            
            /**
             * Show the goto line dialog
             */
            show : function(){ gotoline(1); },
            
            /**
             * Hide the goto line dialog
             */
            hide : function(){ gotoline(2); }
        });
        
        register(null, {
            "ace.gotoline": plugin
        });
    }
});