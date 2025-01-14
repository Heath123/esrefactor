/*
  Copyright (C) 2013 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global esprima:true, estraverse:true, escope: true,
define:true, require:true, exports:true */

const esprima = require('esprima');
const escope = require('eslint-scope');
const estraverse = require('estraverse');

function Context(code) {
    this._code = null;
    this._syntax = null;
    this._scopeManager = null;
    this._rangeToNodeLookup = null;
    if (code) {
        this.setCode(code);
    }
}

Context.prototype.setCode = function (code) {
    this._code = null;
    this._syntax = null;
    this._scopeManager = null;
    if (typeof code === 'string') {
        this._code = code;
        this._syntax = esprima.parse(code, { range: true });
    } else if (typeof code === 'object' && code.type === 'Program') {
        if (typeof getRange(code) !== 'object' || getRange(code).length !== 2) {
            throw new Error('esrefactor.Context only accepts a syntax tree with range information');
        }
        this._syntax = code;
    }
    this._scopeManager = escope.analyze(this._syntax, { ecmaVersion: 2022 });
    this._rangeToNodeLookup = {};
    
    scopeManager = this._scopeManager;
    scopeManager.attach();
    estraverse.traverse(this._syntax, {
        enter: (node) => {
            scope = scopeManager.acquire(node) || scope;
            if (node.type === esprima.Syntax.Identifier || node.type === esprima.Syntax.FunctionDeclaration) {
                const id = node.type === esprima.Syntax.Identifier ? node : node.id;
                if (this._rangeToNodeLookup[getRange(id)[0]]) {
                    return
                }
                this._rangeToNodeLookup[getRange(id)[0]] = {
                    func: node.type === esprima.Syntax.FunctionDeclaration,
                    scope: scope,
                    identifier: id
                }
            }
        },
        leave: (node) => {
            scope = scopeManager.release(node) || scope;
        }
    });
};

// For compatibility with acorn ASTs
function getRange(node) {
    if (node.range) {
        return node.range;
    } else {
        return [node.start, node.end];
    }
}

function locateDeclaration(ref) {
    var scope, i, v;

    if (ref.resolved) {
        return ref.resolved.defs[ref.resolved.defs.length - 1].name;
    }

    scope = ref.from;
    do {
        for (i = 0; i < scope.variables.length; ++i) {
            v = scope.variables[i];
            if (v.name === ref.identifier.name && v.defs.length) {

                // Since we're taking from the end of the array, we can sort
                // these so we don't accidentally pick up an implicit definition.

                var def = v.defs.length > 1 ? v.defs.sort(function (a) {
                return a.type !== 'ImplicitGlobalVariable'
                })[v.defs.length - 1] : v.defs[v.defs.length - 1];
                return def.type !== 'ImplicitGlobalVariable' ? def.name : null;
            }
        }
        scope = scope.upper;
    } while (scope);

    return null;
}

// Given the scope, look up the reference which corresponds to the identifier
// in the specified cursor position. If possible, find also the corresponding
// declaration for that reference.

Context.prototype._lookup = function (scope, identifier) {
    var i, j, ref;

    for (i = 0; i < scope.references.length; ++i) {
        ref = scope.references[i];
        if (ref.identifier === identifier) {
            return {
                identifier: identifier,
                declaration: locateDeclaration(ref)
            };
        }
    }

    for (i = 0; i < scope.variableScope.variables.length; ++i) {
        ref = scope.variableScope.variables[i];
        for (j = 0; j < ref.identifiers.length; ++j) {
            if (ref.identifiers[j] === identifier) {
                return {
                    identifier: identifier,
                    declaration: identifier
                };
            }
        }
    }

};

// Given the cursor position, locate the identifier in that position.
// If there is no identifier in that position, undefined will be returned.
//
// The returned object will have the following property:
//    identifier: the syntax node associated with the identifier
//   declaration: the syntax node where the identifier is declared
//    references: an array of the references of the identifier
//
// Note that the references array also includes the identifier but it
// does exclude the declaration.
//
// Example:
//     var ctx = new esrefactor.Context('var x; x; x = 42');
//     var id = ctx.identify(10);
//
//  id will have the value of:
//      {
//        identifier: {
//          type: 'Identifier',
//          name: 'x',
//          range: [10, 11]
//        },
//        declaration: {
//          type: 'Identifier',
//          name: 'x',
//          range: [4, 5]
//        },
//        references: [{
//          type: 'Identifier',
//          name: 'x',
//          range: [7, 8]
//        }, {
//          type: 'Identifier',
//          name: 'x',
//          range: [10, 11]
//        }]
//      }

Context.prototype.identify = function (pos) {
    var /*identifier, scopeManager,*/ lookup, result; // , scope, func;

    if (!this._syntax) {
        throw new Error('Unable to identify anything without a syntax tree');
    }
    if (!this._scopeManager) {
        throw new Error('Unable to identify anything without a valid scope manager');
    }

    scopeManager = this._scopeManager;
    lookup = this._lookup;

    /* scopeManager.attach();
    estraverse.traverse(this._syntax, {
        enter: function (node) {
            scope = scopeManager.acquire(node) || scope;
            if (node.type === esprima.Syntax.Identifier) {
                if (getRange(node)[0] <= pos && getRange(node)[1] >= pos) {
                    identifier = node;
                    return estraverse.VisitorOption.Break;
                }
            } else if (node.type === esprima.Syntax.FunctionDeclaration) {
                if (getRange(node.id)[0] <= pos && getRange(node.id)[1] >= pos) {
                func = true;
                identifier = node.id;
                return estraverse.VisitorOption.Break;
                }

            }
        },
        leave: function (node) {
            scope = scopeManager.release(node) || scope;
        }
    });
    scopeManager.detach(); */

    const { func, scope, identifier } = this._rangeToNodeLookup[pos]

    if (!identifier) {
        return;
    }

    result = lookup(scope, identifier);

    // If this is a function declaration, we must also check the upper scope.
    if (func && !result && scope.upper) {
        result = lookup(scope.upper, identifier);
    }

    if (result) {
        // Search for all other identical references (same scope).
        result.references = [];
        scopeManager.attach();
        estraverse.traverse(scope.block, {
            enter: function (node) {
                var scope, i, ref, d;
                scope = scopeManager.acquire(node);
                for (i = 0; i < (scope ? scope.references.length : 0); ++i) {
                    ref = scope.references[i];
                    if (ref.identifier.name === identifier.name) {
                        d = lookup(scope, ref.identifier);
                        if (d && d.declaration === result.declaration) {
                            result.references.push(ref.identifier);
                        }
                    }
                }
            }
        });
        scopeManager.detach();

        result.func = func;
    }

    return result;
};

// Rename the identifier and its reference to a new specific name.
// The return value is the new code after the identifier is renamed.
//
// This functions needs identification, which is obtain using identify() function.
//
// Example:
//   var ctx = new esrefactor.Context('var x; x = 42');
//   var id = ctx.identify(4);
//   var code = ctx.rename(id, 'y');
//
// code will be `var y; y = 42'.

Context.prototype.rename = function (identification, name) {
    var result, list, set, i, id, entry;

    result = this._code || this._syntax;
    if (typeof identification === 'undefined') {
        return result;
    }

    list = [getRange(identification.identifier)];
    if (identification.declaration) {
        list.push(getRange(identification.declaration));
    }
    for (i = 0; i < identification.references.length; ++i) {
        list.push(getRange(identification.references[i]));
    }

    // Sort the references based on the position to prevent
    // shifting all the ranges.
    list.sort(function (a, b) { return b[0] - a[0]; });

    // Prevent double renaming, get the unique set.
    set = [];
    set.push(list[0]);
    for (i = 1; i < list.length; ++i) {
        if (list[i][0] !== list[i - 1][0]) {
            set.push(list[i]);
        }
    }

    for (i = 0; i < set.length; ++i) {
        if (this._code) {
            result = result.slice(0, set[i][0]) + name + result.slice(set[i][1]);
        } else {
            // Change the name in the AST
            this._rangeToNodeLookup[set[i][0]].identifier.name = name;
        }
    }

    return result;
};

exports.Context = Context;
