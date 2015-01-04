/*
Copyright 2014 Spotify AB

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/* global document */

var EMPTY_STACK = "	<empty stack>";

// This method is called from HTML so we need to tell JSHint it's not unused
function analyzeTextfield() { // jshint ignore: line
    var text = document.getElementById("TEXTAREA").value;

    var analyzer = new Analyzer(text);
    setHtml("OUTPUT", analyzer.toHtml());

    var ignores = analyzer.toIgnoresHtml();
    setHtml("IGNORED", ignores);

    var running = analyzer.toRunningHtml();
    setHtml("RUNNING", running);

    var synchronizers = analyzer.toSynchronizersHtml();
    setHtml("SYNCHRONIZERS", synchronizers);

    var runningHeader = document.getElementById("RUNNING_HEADER");
    runningHeader.innerHTML = "Top Methods From " +
        analyzer.countedRunningMethods.length +
        " Running Threads";
}

// This method is called from HTML so we need to tell JSHint it's not unused
function clearTextfield() { // jshint ignore: line
    var textArea = document.getElementById("TEXTAREA");
    textArea.value = "";

    // Clear the analysis as well
    analyzeTextfield();
}

function htmlEscape(unescaped) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(unescaped));
    var escaped = div.innerHTML;
    return escaped;
}

function stringToId(string) {
    return encodeURIComponent(string).replace("'", "%27");
}

function setHtml(name, html) {
    var destination = document.getElementById(name);
    destination.innerHTML = html;

    var div = document.getElementById(name + '_DIV');
    div.style.display = (html.length > 0) ? 'inline' : 'none';
}

// Extracts a substring from a string.
//
// Returns an object with two properties:
// value = the first group of the extracted object
// shorterString = the string with the full contents of the regex removed
function _extract(regex, string) {
    var match = regex.exec(string);
    if (match === null) {
        return {value: undefined, shorterString: string};
    }

    return {value: match[1], shorterString: string.replace(regex, "")};
}

function decorateStackFrames(stackFrames) {
    if (stackFrames.length === 0) {
        return [ EMPTY_STACK ];
    }

    var decorated = [];
    for (var i = 0; i < stackFrames.length; i++) {
        decorated.push('	at ' + stackFrames[i]);
    }
    return decorated;
}

function Thread(line) {
    this.toString = function() {
        return this.toHeaderString() + '\n' + this.toStackString();
    };

    this.isValid = function() {
        return this.hasOwnProperty('name') && this.name !== undefined;
    };

    // Return true if the line was understood, false otherwise
    this.addStackLine = function(line) { //jshint ignore:line
        var match;

        var FRAME = /^\s+at (.*)/;
        match = line.match(FRAME);
        if (match !== null) {
            this.frames.push(match[1]);
            return true;
        }

        var THREAD_STATE = /^\s*java.lang.Thread.State: (.*)/;
        match = line.match(THREAD_STATE);
        if (match !== null) {
            this.threadState = match[1];
            this.running = (this.threadState === "RUNNABLE") && (this.state === 'runnable');
            return true;
        }

        var SYNCHRONIZATION_STATUS = /^\s+- (.*?) +<([x0-9a-f]+)> \(a (.*)\)/;
        match = line.match(SYNCHRONIZATION_STATUS);
        if (match !== null) {
            var state = match[1];
            var id = match[2];
            var className = match[3];
            this.synchronizerClasses[id] = className;

            switch (state) {
            case "waiting on":
                this.wantNotificationOn = id;
                return true;

            case "parking to wait for":
                this.wantToAcquire = id;
                return true;

            case "waiting to lock":
                this.wantToAcquire = id;
                return true;

            case "locked":
                if (this.wantNotificationOn === id) {
                    // Lock is released while waiting for the notification
                    return true;
                }
                this.locksHeld.push(id);
                return true;

            default:
                return false;
            }
        }

        var HELD_LOCK = /^\s+- <([x0-9a-f]+)> \(a (.*)\)/;
        match = line.match(HELD_LOCK);
        if (match !== null) {
            var lockId = match[1];
            var lockClassName = match[2];
            this.synchronizerClasses[lockId] = lockClassName;
            this.locksHeld.push(lockId);
            return true;
        }

        var LOCKED_OWNABLE_SYNCHRONIZERS = /^\s+Locked ownable synchronizers:/;
        match = line.match(LOCKED_OWNABLE_SYNCHRONIZERS);
        if (match !== null) {
            // Ignore these lines
            return true;
        }

        var NONE_HELD = /^\s+- None/;
        match = line.match(NONE_HELD);
        if (match !== null) {
            // Ignore these lines
            return true;
        }

        return false;
    };

    this.toStackString = function() {
        return decorateStackFrames(this.frames).join('\n');
    };

    this.toHeaderString = function() {
        var headerString = "";
        if (this.group !== undefined) {
            headerString += '"' + this.group + '"/';
        }
        headerString += '"' + this.name + '": ' + (this.daemon ? "daemon, " : "") + this.state;
        return headerString;
    };

    // Get the name of this thread wrapped in an <a href=>
    this.getLinkedName = function() {
        return '<a class="internal" href="#' + this.tid + '">' + htmlEscape(this.name) + '</a>';
    };

    var match;
    match = _extract(/\[([0-9a-fx,]+)\]$/, line);
    this.dontKnow = match.value;
    line = match.shorterString;

    match = _extract(/ nid=([0-9a-fx,]+)/, line);
    this.nid = match.value;
    line = match.shorterString;

    match = _extract(/ tid=([0-9a-fx,]+)/, line);
    this.tid = match.value;
    line = match.shorterString;

    match = _extract(/ prio=([0-9]+)/, line);
    this.prio = match.value;
    line = match.shorterString;

    match = _extract(/ os_prio=([0-9a-fx,]+)/, line);
    this.osPrio = match.value;
    line = match.shorterString;

    match = _extract(/ (daemon)/, line);
    this.daemon = (match.value !== undefined);
    line = match.shorterString;

    match = _extract(/ #([0-9]+)/, line);
    this.number = match.value;
    line = match.shorterString;

    match = _extract(/ group="(.*)"/, line);
    this.group = match.value;
    line = match.shorterString;

    match = _extract(/^"(.*)" /, line);
    this.name = match.value;
    line = match.shorterString;

    this.state = line.trim();
    this.running = false;

    if (this.name === undefined) {
        return undefined;
    }

    this.frames = [];
    this.wantNotificationOn = null;
    this.wantToAcquire = null;
    this.locksHeld = [];
    this.synchronizerClasses = {};
}

function StringCounter() {
    this.addString = function(string, source) {
        if (!this._stringsToCounts.hasOwnProperty(string)) {
            this._stringsToCounts[string] = {count: 0, sources: []};
        }
        this._stringsToCounts[string].count++;
        this._stringsToCounts[string].sources.push(source);
        this.length++;
    };

    this.hasString = function(string) {
        return this._stringsToCounts.hasOwnProperty(string);
    };

    // Returns all individual string and their counts as
    // {count:5, string:"foo", sources: [...]} hashes.
    this.getStrings = function() {
        var returnMe = [];

        for (var string in this._stringsToCounts) {
            var count = this._stringsToCounts[string].count;
            var sources = this._stringsToCounts[string].sources;
            returnMe.push({count:count, string:string, sources:sources});
        }

        returnMe.sort(function(a, b) {
            if (a.count === b.count) {
                return a.string < b.string ? -1 : 1;
            }

            return b.count - a.count;
        });

        return returnMe;
    };

    this.toString = function() {
        var string = "";
        var countedStrings = this.getStrings();
        for (var i = 0; i < countedStrings.length; i++) {
            if (string.length > 0) {
                string += '\n';
            }
            string += countedStrings[i].count +
                " " + countedStrings[i].string;
        }
        return string;
    };

    this.toHtml = function() {
        var html = "";
        var countedStrings = this.getStrings();
        for (var i = 0; i < countedStrings.length; i++) {
            html += '<tr><td class="right-align">' +
                countedStrings[i].count +
                '</td><td class="raw">' +
                htmlEscape(countedStrings[i].string) +
                "</td></tr>\n";
        }
        return html;
    };

    this._stringsToCounts = {};
    this.length = 0;
}

function Synchronizer(id, className) {
    this.toHtmlTableRow = function() {
        var html = "";
        html += "<tr>";

        html += '<td class="synchronizer">';
        html += '<div class="synchronizer">';
        // FIXME: How should we handle class names like
        //   "java.lang.Class for
        //   org.netbeans.modules.profiler.ProfilerControlPanel2"?
        // FIXME: Strip package names from class names
        html += this._id + "<br>" + this._className;
        html += "</div>";
        html += "</td>";

        // Start of lock info
        html += '<td class="synchronizer">';

        if (this.lockHolder !== null) {
            html += '<div class="synchronizer">';
            html += 'Held by:<br><span class="raw">  ' + this.lockHolder.getLinkedName() + '</span>';
            html += "</div>";
        }

        if (this.lockWaiters.length > 0) {
            html += '<div class="synchronizer">';
            html += "Threads waiting to take lock:";
            for (var i = 0; i < this.lockWaiters.length; i++) {
                var lockWaiter = this.lockWaiters[i];
                html += '<br><span class="raw">  ' + lockWaiter.getLinkedName() + '</span>';
            }
            html += "</div>";
        }

        if (this.notificationWaiters.length > 0) {
            html += '<div class="synchronizer">';
            html += "Threads waiting for notification on lock:";
            for (var j = 0; j < this.notificationWaiters.length; j++) {
                var notificationWaiter = this.notificationWaiters[j];
                html += '<br><span class="raw">  ' + notificationWaiter.getLinkedName() + '</span>';
            }
            html += "</div>";
        }

        // End of lock info
        html += "</td>";

        html += "</tr>";
        return html;
    };

    this._id = id;
    this._className = className;

    this.notificationWaiters = [];
    this.lockWaiters = [];
    this.lockHolder = null;
}

// Create an analyzer object
function Analyzer(text) {
    this._handleLine = function(line) {
        var thread = new Thread(line);
        var parsed = false;
        if (thread.isValid()) {
            this.threads.push(thread);
            this._currentThread = thread;
            parsed = true;
        } else if (/^\s*$/.exec(line)) {
            // We ignore empty lines, and lines containing only whitespace
            parsed = true;
        } else if (this._currentThread !== null) {
            parsed = this._currentThread.addStackLine(line);
        }

        if (!parsed) {
            this._ignores.addString(line);
        }
    };

    this._analyze = function(text) {
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            while (line.charAt(0) === '"' && line.indexOf('prio=') === -1) {
                // Multi line thread name
                i++;
                if (i >= lines.length) {
                    break;
                }

                // Replace thread name newline with ", "
                line += ', ' + lines[i];
            }

            this._handleLine(line);
        }
    };

    // Returns an array [{threads:, stackFrames:,} ...]. The threads:
    // field contains an array of Threads. The stackFrames contain an
    // array of strings
    this._toThreadsAndStacks = function() {
        // Map stacks to which threads have them
        var stacksToThreads = {};
        for (var i = 0; i < this.threads.length; i++) {
            var thread = this.threads[i];
            var stackString = thread.toStackString();
            if (!stacksToThreads.hasOwnProperty(stackString)) {
                stacksToThreads[stackString] = [];
            }
            stacksToThreads[stackString].push(thread);
        }

        // List stacks by popularity
        var stacks = [];
        for (var stack in stacksToThreads) {
            stacks.push(stack);
        }
        stacks.sort(function(a, b) {
            if (a === b) {
                return 0;
            }

            var scoreA = stacksToThreads[a].length;
            if (a === EMPTY_STACK) {
                scoreA = -123456;
            }

            var scoreB = stacksToThreads[b].length;
            if (b === EMPTY_STACK) {
                scoreB = -123456;
            }

            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }

            // Use stack contents as secondary sort key. This is
            // needed to get deterministic enough output for being
            // able to run our unit tests in both Node.js and in
            // Chrome.
            if (a < b) {
                return -1;
            } else {
                return 1;
            }
        });

        // Iterate over stacks and for each stack, print first all
        // threads that have it, and then the stack itself.
        var threadsAndStacks = [];
        for (var j = 0; j < stacks.length; j++) {
            var currentStack = stacks[j];
            var threads = stacksToThreads[currentStack];

            threads.sort(function(a, b){
                var aHeader = a.toHeaderString();
                var bHeader = b.toHeaderString();
                if (aHeader > bHeader) {
                    return 1;
                }
                if (aHeader < bHeader) {
                    return -1;
                }
                return 0;
            });

            threadsAndStacks.push({
                threads: threads,
                stackFrames: threads[0].frames
            });
        }

        return threadsAndStacks;
    };

    this._stackToHtml = function(stackFrames) {
        if (stackFrames.length === 0) {
            return '<div class="raw">' + htmlEscape(EMPTY_STACK) + '</div>\n';
        }

        var asHtml = "";
        var href;
        for (var i = 0; i < stackFrames.length; i++) {
            href = undefined;
            var stackFrame = stackFrames[i];

            if (this.countedRunningMethods.hasString(stackFrame)) {
                href = "#" + stringToId(stackFrame);
            }

            asHtml += '<div class="raw">	at ';

            if (href) {
                asHtml += '<a class="internal" href="' + href + '">';
            }
            asHtml += htmlEscape(stackFrames[i]);
            if (href) {
                asHtml += '</a>';
            }

            asHtml += "</div>\n";
        }

        return asHtml;
    };

    this.toHtml = function() {
        if (this.threads.length === 0) {
            return "";
        }

        var threadsAndStacks = this._toThreadsAndStacks();

        var asHtml = "";
        asHtml += '<h2>' + this.threads.length + " threads found</h2>\n";
        for (var i = 0; i < threadsAndStacks.length; i++) {
            var currentThreadsAndStack = threadsAndStacks[i];
            var threads = currentThreadsAndStack.threads;

            asHtml += '<div class="threadgroup">\n';
            if (threads.length > 4) {
                asHtml += '<div class="threadcount">' + threads.length + " threads with this stack:</div>\n";
            } else {
                // Having an empty div here makes all paragraphs, both
                // those with and those without headings evenly spaced.
                asHtml += '<div class="threadcount"></div>\n';
            }

            for (var j = 0; j < threads.length; j++) {
                var thread = threads[j];
                asHtml += '<div class="raw" id="' +
                    thread.tid +
                    '">' +
                    htmlEscape(thread.toHeaderString()) +
                    '</div>\n';
            }

            asHtml += this._stackToHtml(currentThreadsAndStack.stackFrames);

            asHtml += '</div>\n';
        }

        return asHtml;
    };

    this.toIgnoresString = function() {
        return this._ignores.toString() + '\n';
    };

    this.toIgnoresHtml = function() {
        return this._ignores.toHtml();
    };

    this.toRunningString = function() {
        return this.countedRunningMethods.toString();
    };

    this.toRunningHtml = function() {
        var html = "";
        var countedStrings = this.countedRunningMethods.getStrings();
        for (var i = 0; i < countedStrings.length; i++) {
            var countedString = countedStrings[i];

            html += '<tr id="';
            html += stringToId(countedString.string);
            html += '"><td class="right-align">';
            html += countedString.count;
            html += '</td><td class="raw">';

            // Link to the thread currently executing this method
            if (countedString.count === 1) {
                html += '<a class="internal" href="#' + countedString.sources[0].tid + '">';
            }
            html += htmlEscape(countedString.string);
            if (countedString.count === 1) {
                html += '</a>';
            }

            html += "</td></tr>\n";
        }
        return html;
    };

    this._countRunningMethods = function() {
        var countedRunning = new StringCounter();
        for (var i = 0; i < this.threads.length; i++) {
            var thread = this.threads[i];
            if (!thread.running) {
                continue;
            }

            if (thread.frames.length ===  0) {
                continue;
            }

            var runningMethod = thread.frames[0].replace(/^\s+at\s+/, '');
            countedRunning.addString(runningMethod, thread);
        }

        return countedRunning;
    };

    this.toSynchronizersHtml = function() {
        var html = "";
        for (var i = 0; i < this._synchronizers.length; i++) {
            var synchronizer = this._synchronizers[i];
            html += synchronizer.toHtmlTableRow() + '\n';
        }
        return html;
    };

    this._registerSynchronizer = function(registry, id, synchronizerClasses) {
        if (id === null) {
            return;
        }
        if (registry[id] === undefined) {
            registry[id] = new Synchronizer(id, synchronizerClasses[id]);
        }
    };

    // Create a mapping from synchronizer ids to Synchronizer
    // objects. Note that the Synchronizer objects won't get any cross
    // references from this method; they are don by
    // _enumerateSynchronizers() below.
    this._createSynchronizerById = function() {
        var returnMe = {};

        for (var i = 0; i < this.threads.length; i++) {
            var thread = this.threads[i];

            this._registerSynchronizer(
                returnMe, thread.wantNotificationOn, thread.synchronizerClasses);
            this._registerSynchronizer(
                returnMe, thread.wantToAcquire, thread.synchronizerClasses);

            for (var j = 0; j < thread.locksHeld.length; j++) {
                var lock = thread.locksHeld[j];
                this._registerSynchronizer(
                    returnMe, lock, thread.synchronizerClasses);
            }
        }

        return returnMe;
    };

    // Create a properly cross-referenced array with all synchronizers
    // in the thread dump
    this._enumerateSynchronizers = function() {
        for (var i = 0; i < this.threads.length; i++) {
            var thread = this.threads[i];
            var synchronizer;

            if (thread.wantNotificationOn !== null) {
                synchronizer = this._synchronizerById[thread.wantNotificationOn];
                synchronizer.notificationWaiters.push(thread);
            }

            if (thread.wantToAcquire !== null) {
                synchronizer = this._synchronizerById[thread.wantToAcquire];
                synchronizer.lockWaiters.push(thread);
            }

            for (var j = 0; j < thread.locksHeld.length; j++) {
                synchronizer = this._synchronizerById[thread.locksHeld[j]];
                synchronizer.lockHolder = thread;
            }
        }

        // List all synchronizers
        var synchronizers = [];
        var ids = Object.keys(this._synchronizerById);
        for (var k = 0; k < ids.length; k++) {
            var id = ids[k];
            synchronizers.push(this._synchronizerById[id]);
        }

        // FIXME: Sort the synchronizers by number of references

        return synchronizers;
    };

    this.threads = [];
    this._ignores = new StringCounter();
    this._currentThread = null;

    this._analyze(text);
    this.countedRunningMethods = this._countRunningMethods();
    this._synchronizerById = this._createSynchronizerById();
    this._synchronizers = this._enumerateSynchronizers();
}
