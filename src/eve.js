var FAILED = 0;
var CHANGED = 1;
var UNCHANGED = 2;

var IGNORED = 0;
var SPLITTED = 1;

var eve = {};

// UTIL

function assert(cond, msg) {
  if(!cond) {
    throw new Error(msg);
  }
}

function makeArray(len, fill) {
  var arr = [];
  for(var i = 0; i < len; i++) {
    arr[i] = fill;
  }
  return arr;
}

var now = function() {
  if(typeof window !== "undefined" && window.performance) {
    return window.performance.now();
  }
  return (new Date()).getTime();
};

// ORDERING / COMPARISON

var least = false;
var greatest = undefined;

function compareValue(a, b) {
  if(a === b) return 0;
  var at = typeof a;
  var bt = typeof b;
  if((at === bt && a < b) || (at < bt)) return -1;
  return 1;
}

function compareValueArray(a, b) {
  var len = a.length;
  if(len !== b.length) throw new Error("compareValueArray on arrays of different length: " + a + " :: " + b);
  for(var i = 0; i < len; i++) {
    var comp = compareValue(a[i], b[i]);
    if(comp !== 0) return comp;
  }
  return 0;
}

function arrayEqual(a, b) {
  var len = a.length;
  assert(len === b.length);
  for(var i = 0; i < len; i++) {
    if(a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function boundsContainsPoint(los, his, ixes, point) {
  for (var i = ixes.length - 1; i >= 0; i--) {
    var ix = ixes[i];
    if (ix !== undefined) {
      if (compareValue(point[i], los[ix]) === -1) return false;
      if (compareValue(point[i], his[ix]) === 1) return false;
    }
  }
  return true;
}

function solutionMatchesPoint(solution, ixes, point) {
  for (var i = ixes.length - 1; i >= 0; i--) {
    var ix = ixes[i];
    if ((ix !== undefined) && (point[i] !== solution[ix])) return false;
  }
  return true;
}

// MEMORY
// track a multi-set of facts
// supports bounds refinement

function Memory(facts) {
  this.facts = facts;
}

Memory.empty = function() {
  return new Memory([]);
};

Memory.fromFacts = function(facts) {
  return new Memory(facts.slice());
};


function dedupeFacts(facts) {
  var len = facts.length;
  if (len === 0) return [];
  facts.sort(compareValueArray);
  var nextFact = facts[0];
  var lastFact;
  var dedupedFacts = [nextFact];
  for (var i = 1; i < len; i++) {
    lastFact = nextFact;
    nextFact = facts[i];
    if (arrayEqual(lastFact, nextFact) === false) {
      dedupedFacts.push(nextFact);
    }
  }
  return dedupedFacts;
}

function diffFacts(oldFacts, newFacts, outputAdds, outputDels) {
  oldFacts = dedupeFacts(oldFacts);
  newFacts = dedupeFacts(newFacts);
  var oldLen = oldFacts.length;
  var newLen = newFacts.length;
  var oldIx = 0;
  var newIx = 0;
  diff: while (true) {
    if (oldIx >= oldLen) {
      for (; newIx < newLen; newIx++) {
        outputAdds.push(newFacts[newIx]);
      }
      break diff;
    }
    if (newIx >= newLen) {
      for (; oldIx < oldLen; oldIx++) {
        outputDels.push(oldFacts[oldIx]);
      }
      break diff;
    }
    var nextOld = oldFacts[oldIx];
    var nextNew = newFacts[newIx];
    var comp = compareValueArray(nextOld, nextNew);
    if (comp === 0) {
      oldIx++;
      newIx++;
      continue diff;
    }
    if (comp === 1) {
      outputAdds.push(nextNew);
      newIx++;
      continue diff;
    }
    if (comp === -1) {
      outputDels.push(nextOld);
      oldIx++;
      continue diff;
    }
  }
}

Memory.prototype = {
  update: function(adds, dels) {
    if ((adds.length === 0) && (dels.length === 0)) return this;

    var facts = this.facts.slice();
    for (var i = adds.length - 1; i >= 0; i--) {
      facts.push(adds[i]);
    }
    nextDel: for (var i = dels.length - 1; i >= 0; i--) {
      var del = dels[i];
      for (var j = facts.length - 1; j >= 0; j--) {
        var fact = facts[j];
        if ((del.length === fact.length) && arrayEqual(del, fact)) {
          facts.splice(j, 1);
          continue nextDel;
        }
      }
    }

    return new Memory(facts);
  },

  diff: function(oldTree, outputAdds, outputDels) {
    // TODO hacky gross diffing
    diffFacts(oldTree.facts, this.facts, outputAdds, outputDels);
  },

  differsFrom: function(oldTree) {
    var adds = [], dels = [];
    this.diff(oldTree, adds, dels);
    return (adds.length > 0) || (dels.length > 0);
  },

  getFacts: function() {
    return dedupeFacts(this.facts);
  },

  isEmpty: function() {
    return (this.facts.length === 0);
  }
};

function MemoryConstraint(storeIx, fieldIxes) {
  this.storeIx = storeIx;
  this.fieldIxes = fieldIxes;
}

MemoryConstraint.prototype = {
  start: function(system) {
    return system.getStore(this.storeIx).getFacts();
  },

  propagate: function(myIx, constraintStates, los, his) {
    var fieldIxes = this.fieldIxes;
    var facts = constraintStates[myIx];

    // console.log("Facts before " + los + " " + his + " " + JSON.stringify(facts));

    var newFacts = [];

    for (var i = facts.length - 1; i >= 0; i--) {
      var fact = facts[i];
      if (boundsContainsPoint(los, his, fieldIxes, fact) === true) {
        newFacts.push(fact);
      }
    }

    facts = constraintStates[myIx] = newFacts;

    // console.log("Facts after " + los + " " + his + " " + JSON.stringify(facts));

    if (facts.length === 0) {
      // console.log("Failed with no facts");
      return FAILED;
    }

    var changed = false;

    for (var i = fieldIxes.length - 1; i >= 0; i--) {
      var newLo = greatest;
      var newHi = least;
      for (var j = facts.length - 1; j >= 0; j--) {
        var value = facts[j][i];
        if (compareValue(value, newLo) === -1) newLo = value;
        if (compareValue(value, newHi) === 1) newHi = value;
      }
      var ix = fieldIxes[i];
      if (compareValue(newLo, los[ix]) === 1) {
        los[ix] = newLo;
        changed = true;
      }
      if (compareValue(newHi, his[ix]) === -1) {
        his[ix] = newHi;
        changed = true;
      }
    }

    return (changed === true) ? CHANGED : UNCHANGED;
  },

  split: function(myIx, leftConstraintStates, leftLos, leftHis, rightConstraintStates, rightLos, rightHis) {
    var facts = leftConstraintStates[myIx];
    if (facts.length < 2) return IGNORED;

    var fieldIxes = this.fieldIxes;

    var i, ix, lowerPivot;
    findLowerPivot: for (i = fieldIxes.length - 1; i >= 0; i--) {
      ix = fieldIxes[i];
      if (ix !== undefined) {
        for (var j = facts.length - 1; j >= 0; j--) {
          lowerPivot = facts[j][i];
          if (lowerPivot !== leftHis[ix]) break findLowerPivot;
        }
      }
    }

    if(i < 0) return IGNORED;

    var upperPivot = greatest;
    for (var j = facts.length - 1; j >= 0; j--) {
      var value = facts[j][i];
      if ((compareValue(value, lowerPivot) === 1) && (compareValue(value, upperPivot) === -1)) upperPivot = value;
    }

    leftHis[ix] = lowerPivot;
    rightLos[ix] = upperPivot;
    // console.log("Split at fact[" + i + "]=" + lowerPivot + "," + upperPivot);
    return SPLITTED;
  }
};

function NegatedMemoryConstraint(storeIx, fieldIxes) {
  this.storeIx = storeIx;
  this.fieldIxes = fieldIxes;
}

NegatedMemoryConstraint.prototype = {
  start: function(system) {
    return system.getStore(this.storeIx).getFacts();
  },

  propagate: function(myIx, constraintStates, los, his) {
    var facts = constraintStates[myIx];
    var fieldIxes = this.fieldIxes;

    for (var i = fieldIxes.length - 1; i >= 0; i--) {
      var ix = fieldIxes[i];
      if ((ix !== undefined) && (los[ix] !== his[ix])) return UNCHANGED;
    }

    for (var i = facts.length - 1; i >= 0; i--) {
      if (solutionMatchesPoint(los, fieldIxes, facts[i]) === true) {
        // console.log("Negation failed on " + facts[i]);
        return FAILED;
      }
    }
  },

  split: function(myIx, leftConstraintStates, leftLos, leftHis, rightConstraintStates, rightLos, rightHis) {
    return false;
  }
};

// PROVENANCE
// responsible for avoiding redundant computation and calculating diffs

function Provenance(numVars, constraints, outputIx) {
  this.numVars = numVars;
  this.constraints = constraints;
  this.queuedAdds = [];
  this.outputIx = outputIx;
}

Provenance.empty = function(numVars, constraints, outputIx) {
  return new Provenance(numVars, constraints, outputIx);
};

Provenance.prototype = {
  // provenance interface
  // (all inputs may be aliased)

  propagated: function (oldLos, oldHis, newLos, newHis, constraintIx) {},

  splitted: function (oldLos, oldHis, leftLos, leftHis, rightLos, rightHis, constraintIx) {},

  failed: function (oldLos, oldHis, ix) {},

  solved: function (solution) {
    this.queuedAdds.push(solution.slice());
  },

  // constraint interface

  start: function (system) {
    return null;
  },

  finish: function(system) {
    var oldOutput = system.getStore(this.outputIx) || Memory.empty();
    var newOutput = Memory.fromFacts(this.queuedAdds);
    this.queuedAdds = [];
    if (newOutput.differsFrom(oldOutput)) system.setStore(this.outputIx, newOutput);
  },

  propagate: function(myIx, constraintStates, los, his) {
    return UNCHANGED;
  },

  split: function(myIx, leftConstraintStates, leftLos, leftHis, rightConstraintStates, rightLos, rightHis) {
    return IGNORED;
  }
};

// FUNCTIONS

function FunctionConstraint(fun, args, inIxes, outIx) {
  this.fun = fun;
  this.args = args;
  this.inIxes = inIxes;
  this.outIx = outIx;
  this.inValues = makeArray(inIxes.length, null);
}

FunctionConstraint.prototype = {
  start: function(system) {
    return null;
  },

  propagate: function(myIx, constraintStates, los, his) {
    var inIxes = this.inIxes;
    var inValues = this.inValues;

    for (var i = inIxes.length - 1; i >= 0; i--) {
      var inIx = inIxes[i];
      var lo = los[inIx];
      if ((lo !== his[inIx])) return UNCHANGED;
      inValues[i] = lo;
    }

    var outIx = this.outIx;
    var outValue = this.fun.apply(null, inValues);
    var compLo = compareValue(outValue, los[outIx]);
    var compHi = compareValue(outValue, his[outIx]);
    if ((compLo === -1) || (compHi === 1)) return FAILED;
    if (outIx !== undefined) {
      los[outIx] = outValue;
      his[outIx] = outValue;
      return ((compLo === 1) || (compHi === -1)) ? CHANGED : UNCHANGED;
    } else {
      return UNCHANGED;
    }
  },

  split: function(myIx, leftConstraintStates, leftLos, leftHis, rightConstraintStates, rightLos, rightHis) {
    return IGNORED;
  }
};

// SOLVER

function Solver(numVars, constants, constraints, provenance) {
  this.numVars = numVars;
  this.constants = constants;
  this.constraints = constraints;
  this.provenance = provenance;
}

Solver.empty = function (numVars, constants, constraints, outputIx) {
  var provenance = Provenance.empty(numVars, constraints, outputIx);
  constraints.push(provenance);
  return new Solver(numVars, constants, constraints, provenance);
};

function pushInto(depth, elem, queue) {
  var start = depth * elem.length;
  for (var i = elem.length - 1; i >= 0; i--) {
    queue[start + i] = elem[i];
  }
}

function popFrom(depth, elem, queue) {
  var start = depth * elem.length;
  for (var i = elem.length - 1; i >= 0; i--) {
    elem[i] = queue[start + i];
  }
}

Solver.prototype = {
  refresh: function(system) {
    var provenance = this.provenance;
    var numVars = this.numVars;
    var constraints = this.constraints;
    var numConstraints = constraints.length;

    var constraintStates = [];
    for (var i = constraints.length - 1; i >= 0; i--) {
      var constraintState = constraints[i].start(system);
      if (constraintState === false) return; // constraint is trivially unsatisfiable - eg provenance constraint when nothing is dirty
      constraintStates[i] = constraintState;
    }

    var los = makeArray(numVars, least);
    var his = makeArray(numVars, greatest);
    var constants = this.constants;
    for (var i = constants.length - 1; i >= 0; i--) {
      var constant = constants[i];
      if (constant !== undefined) {
        los[i] = constant;
        his[i] = constant;
      }
    }

    // buffers for splitting;
    var rightConstraintStates = constraintStates.slice();
    var rightLos = los.slice();
    var rightHis = his.slice();

    // stack for depth-first search
    var depth = 0;
    var queuedConstraintStates = [];
    var queuedLos = [];
    var queuedHis = [];

    // console.log("Starting solve");

    solve: while (true) {

      // propagate all constraints until nothing changes
      var lastChanged = 0;
      var current = 0;
      propagate: while (true) {
        // console.log("Before prop " + current + " " + los + " " + his);
        var result = constraints[current].propagate(current, constraintStates, los, his);
        if (result === FAILED) {
          provenance.failed(); // TODO
          if (depth === 0) break solve;
          depth -= 1;
          popFrom(depth, constraintStates, queuedConstraintStates);
          popFrom(depth, los, queuedLos);
          popFrom(depth, his, queuedHis);
          continue solve;
        } else if (result === CHANGED) {
          provenance.propagated(); // TODO
          lastChanged = current;
        }
        // console.log("After prop " + current + " " + los + " " + his);
        current = (current + 1) % numConstraints;
        if (current === lastChanged) break propagate;
      }

      // check if we are at a solution
      if (arrayEqual(los, his)) {
        provenance.solved(los);
        // console.log("Found " + JSON.stringify(los));
        if (depth === 0) break solve;
        depth -= 1;
        popFrom(depth, constraintStates, queuedConstraintStates);
        popFrom(depth, los, queuedLos);
        popFrom(depth, his, queuedHis);
        continue solve;
      }

      // split the problem in two
      var splitter;
      split: for (splitter = constraints.length - 1; splitter >= 0; splitter--) {
        pushInto(0, constraintStates, rightConstraintStates);
        pushInto(0, los, rightLos);
        pushInto(0, his, rightHis);
        var result = constraints[splitter].split(splitter, constraintStates, los, his, rightConstraintStates, rightLos, rightHis);
        if (result === SPLITTED) {
          provenance.splitted(); // TODO
          break split;
        }
      }
      // console.log("Split by " + splitter);
      assert(splitter >= 0);

      pushInto(depth, rightConstraintStates, queuedConstraintStates);
      pushInto(depth, rightLos, queuedLos);
      pushInto(depth, rightHis, queuedHis);
      depth += 1;

    }

    // console.log("Finished solve");

    provenance.finish(system);
  }
};

// AGGREGATE

function Aggregate(groupIxes, sortIxes, limitIx, ordinalIx, reducerInIxes, reducerOutIxes, reducerFuns, inputIx, outputIx) {
  this.groupIxes = groupIxes;
  this.sortIxes = sortIxes;
  this.limitIx = limitIx;
  this.ordinalIx = ordinalIx;
  this.reducerInIxes = reducerInIxes;
  this.reducerOutIxes = reducerOutIxes;
  this.reducerFuns = reducerFuns;
  this.inputIx = inputIx;
  this.outputIx = outputIx;
}

Aggregate.empty = function (groupIxes, sortIxes, limitIx, ordinalIx, reducerInIxes, reducerOutIxes, reducerFuns, inputIx, outputIx) {
  return new Aggregate(groupIxes, sortIxes, limitIx, ordinalIx, reducerInIxes, reducerOutIxes, reducerFuns, inputIx, outputIx);
};

function groupBy(facts, groupIxes) {
  var groups = {};
  for (var i = facts.length - 1; i >= 0; i--) {
    var fact = facts[i];
    var group = [];
    for (var j = groupIxes.length - 1; j >= 0; j--) {
      group[j] = fact[groupIxes[j]];
    }
    var groupFacts = groups[JSON.stringify(group)] || (groups[JSON.stringify(group)] = []);
    groupFacts.push(fact);
  }
  return groups;
}

function compareSortKey(a,b) {
  return compareValueArray(a[0], b[0]);
}

function sortBy(facts, sortIxes, ordinalIx) {
  for (var i = facts.length - 1; i >= 0; i--) {
    var fact = facts[i];
    var sortKey = [];
    for (var j = sortIxes.length - 1; j >= 0; j--) {
      sortKey[j] = fact[sortIxes[j]];
    }
    facts[i] = [sortKey, fact];
  }
  facts.sort(compareSortKey);
  for (var i = facts.length - 1; i >= 0; i--) {
    var fact = facts[i][1];
    if (ordinalIx !== undefined) fact[ordinalIx] = i;
    facts[i] = fact;
  }
}

function reduceBy(facts, inIx, outIx, fun) {
  var inValues = [];
  for (var i = facts.length - 1; i >= 0; i--) {
    inValues[i] = facts[i][inIx];
  }
  var outValue = fun.call(null, inValues);
  for (var i = facts.length - 1; i >= 0; i--) {
    facts[i][outIx] = outValue;
  }
}

Aggregate.prototype = {
  refresh: function(system) {
    var inputFacts = system.getStore(this.inputIx).getFacts();
    var groups = groupBy(inputFacts, this.groupIxes);
    var outputFacts = [];
    for (var group in groups) {
      var groupFacts = groups[group];
      for (var i = groupFacts.length - 1; i >= 0; i--) {
        groupFacts[i] = groupFacts[i].slice(); // unalias facts from solver
      }
      sortBy(groupFacts, this.sortIxes, this.ordinalIx);
      if (this.limitIx !== undefined) groupFacts = groupFacts.slice(0, groupFacts[0][this.limitIx]);
      var reducerInIxes = this.reducerInIxes;
      var reducerOutIxes = this.reducerOutIxes;
      var reducerFuns = this.reducerFuns;
      for (var i = reducerInIxes.length - 1; i >= 0; i--) {
        reduceBy(groupFacts, reducerInIxes[i], reducerOutIxes[i], reducerFuns[i]);
      }
      for (var i = groupFacts.length - 1; i >= 0; i--) {
        outputFacts.push(groupFacts[i]);
      }
    }
    var oldOutput = system.getStore(this.outputIx);
    var newOutput = Memory.fromFacts(outputFacts);
    if (newOutput.differsFrom(oldOutput)) system.setStore(this.outputIx, newOutput);
  }
};

// SINK

function SinkConstraint(inputIx, fieldIxes) {
  this.inputIx = inputIx;
  this.fieldIxes = fieldIxes;
}

SinkConstraint.prototype = {
  into: function(system, outputFacts) {
    var inputFacts = system.getStore(this.inputIx).facts;
    var fieldIxes = this.fieldIxes;
    for (var i = inputFacts.length - 1; i >= 0; i--) {
      var inputFact = inputFacts[i];
      var outputFact = [];
      for (var j = fieldIxes.length - 1; j >= 0; j--) {
        outputFact[j] = inputFact[fieldIxes[j]];
      }
      outputFacts.push(outputFact);
    }
  }
};

function Sink(constraints, outputIx) {
  this.constraints = constraints;
  this.outputIx = outputIx;
}

Sink.prototype = {
  refresh: function(system) {
    var outputFacts = [];
    var constraints = this.constraints;
    for (var i = constraints.length - 1; i >= 0; i--) {
      constraints[i].into(system, outputFacts);
    }
    var oldOutput = system.getStore(this.outputIx);
    var newOutput = Memory.fromFacts(outputFacts);
    if (newOutput.differsFrom(oldOutput)) system.setStore(this.outputIx, newOutput);
  }
};

// SYSTEM

var compilerTables =
    [["table"],
     ["field"],
     ["rule"],
     ["valve"],
     ["pipe"],
     ["tableConstraint"],
     ["constantConstraint"],
     ["functionConstraint"],
     ["functionConstraintInput"],
     ["limitValve"],
     ["ordinalValve"],
     ["groupValve"],
     ["sortValve"],
     ["reducer"],
     ["flow"],
     ["refresh"],
     ["constraintRule"],
     // TODO adding these here is hacky
     ["program"],
     ["programRule"],
     ["programTable"],
     ["displayName"],
     ["editorRule"],
     ["join"],
     ["externalEvent"]];

var compilerFields =
    [["table", "table", 0],

     ["field", "table", 0],
     ["field", "field", 1],
     ["field", "ix", 2],

     ["rule", "rule", 0],
     ["rule", "ix", 1],

     ["valve", "valve", 0],
     ["valve", "rule", 1],
     ["valve", "ix", 2],

     ["pipe", "pipe", 0],
     ["pipe", "table", 1],
     ["pipe", "rule", 2],
     ["pipe", "direction", 3], // +source, -source, +sink

     ["tableConstraint", "valve", 0],
     ["tableConstraint", "pipe", 1],
     ["tableConstraint", "field", 2],

     ["constantConstraint", "valve", 0],
     ["constantConstraint", "value", 1],

     ["functionConstraint", "function", 0],
     ["functionConstraint", "code", 1],
     ["functionConstraint", "valve", 2],
     ["functionConstraint", "rule", 3], // TODO redundant

     ["functionConstraintInput", "function", 0],
     ["functionConstraintInput", "valve", 1],
     ["functionConstraintInput", "variable", 2],

     ["limitValve", "rule", 0],
     ["limitValve", "valve", 1],

     ["ordinalValve", "rule", 0],
     ["ordinalValve", "valve", 1],

     ["groupValve", "rule", 0],
     ["groupValve", "valve", 1],

     ["sortValve", "rule", 0],
     ["sortValve", "valve", 1],
     ["sortValve", "ix", 2],

     ["reducer", "rule", 0],
     ["reducer", "inValve", 1],
     ["reducer", "outValve", 2],
     ["reducer", "inVariable", 3],
     ["reducer", "code", 4],

     ["flow", "flow", 0],
     ["flow", "originType", 1], // "solver", "aggregate", "source", "sink"
     ["flow", "originId", 2], // for solver/aggregate is rule, for source/sink is table

     ["refresh", "tick", 0],
     ["refresh", "startTime", 1],
     ["refresh", "endTime", 2],
     ["refresh", "flow", 3],

     ["constraintRule", "rule", 0],

     // TODO adding these here is hacky

     ["program", "id", 0],
     ["program", "name", 1],

     ["programRule", "program", 0],
     ["programRule", "rule", 1],

     ["programTable", "program", 0],
     ["programTable", "table", 1],

     ["displayName", "id", 0],
     ["displayName", "name", 1],

     ["editorRule", "id", 0],
     ["editorRule", "description", 1],

     ["join", "id", 0],
     ["join", "valve", 1],
     ["join", "pipe", 2],
     ["join", "field", 3],

     ["externalEvent", "id", 0],
     ["externalEvent", "label", 1],
     ["externalEvent", "key", 2],
     ["externalEvent", "eid", 3],
     ["externalEvent", "value", 4]];

function System(meta, stores, flows, dirtyFlows, constraintFlows, downstream, nameToIx, ixToName) {
  this.meta = meta;
  this.stores = stores;
  this.flows = flows;
  this.dirtyFlows = dirtyFlows;
  this.constraintFlows = constraintFlows;
  this.downstream = downstream;
  this.nameToIx = nameToIx;
  this.ixToName = ixToName;
  this.tick = 0;
}

System.empty = function(meta) {
  var stores = [];
  var flows = [];
  var dirtyFlows = [];
  var constraintFlows = [];
  var downstream = [];
  var nameToIx = {};

  var numFields = {};
  for (var i = compilerTables.length - 1; i >= 0; i--) {
    var name = compilerTables[i][0];
    numFields[name] = 0;
  }
  for (var i = compilerFields.length - 1; i >= 0; i--) {
    var name = compilerFields[i][0];
    numFields[name] += 1;
  }

  for (var i = compilerTables.length - 1; i >= 0; i--) {
    var name = compilerTables[i][0];
    var sourceIx = 2*i;
    var sinkIx = (2*i)+1;

    dirtyFlows[sourceIx] = false;
    stores[sourceIx] = Memory.empty();
    downstream[sourceIx] = [sinkIx];
    nameToIx[name + "-source"] = sourceIx;

    dirtyFlows[sinkIx] = false;
    stores[sinkIx] = Memory.empty();
    downstream[sinkIx] = [];
    nameToIx[name + "-sink"] = sinkIx;

    var sinkFieldIxes = [];
      for (var j = numFields[name] - 1; j >= 0; j--) {
        sinkFieldIxes[j] = j;
      }
    flows[sinkIx] = new Sink([new SinkConstraint(sourceIx, sinkFieldIxes)], sinkIx);
  }

  var ixToName = [];
  for (var name in nameToIx) {
    ixToName[nameToIx[name]] = name;
  }

  var system = new System(meta, stores, flows, dirtyFlows, constraintFlows, downstream, nameToIx, ixToName);
  system.setStore(0, Memory.fromFacts(compilerTables));
  system.setStore(2, Memory.fromFacts(compilerFields));
  return system;
};

System.prototype = {
  getTable: function (table) {
    var sinkIx = this.nameToIx[table + "-sink"];
    return this.getStore(sinkIx);
  },

  updateTable: function (table, adds, dels) {
    var sourceIx = this.nameToIx[table + "-source"];
    var store = this.getStore(sourceIx);
    if (store === undefined) console.error("No store for " + table);
    this.setStore(sourceIx, store.update(adds, dels));
    return this;
  },

  getSolver: function(rule) {
    return this.getStore(this.nameToIx[rule + "-solver"]);
  },

  getAggregate: function(rule) {
    return this.getStore(this.nameToIx[rule + "-aggregate"]);
  },

  getStore: function (storeIx) {
    return this.stores[storeIx];
  },

  setStore: function (storeIx, store) {
    this.stores[storeIx] = store;
    var dirtiedFlows = this.downstream[storeIx];
    var dirtyFlows = this.dirtyFlows;
    for (var i = dirtiedFlows.length - 1; i >= 0; i--) {
      dirtyFlows[dirtiedFlows[i]] = true;
    }
  },

  getDump: function (table) {
    var fields = this.getTable("field").getFacts();
    var tableFields = [];
    for (var i = fields.length - 1; i >= 0; i--) {
      var field = fields[i];
      if (field[0] === table) tableFields[field[2]] = field[1];
    }
    var facts = this.getStore(this.nameToIx[table + "-source"]).getFacts();
    var dump = [];
    for (var i = facts.length - 1; i >= 0; i--) {
      var fact = facts[i];
      var dumpedFact = {};
      for (var j = tableFields.length - 1; j >= 0; j--) {
        dumpedFact[tableFields[j]] = fact[j];
      }
      dump[i] = dumpedFact;
    }
    return dump;
  },

  refresh: function() {
    var tick = this.tick;
    var flows = this.flows;
    var stores = this.stores;
    var numFlows = flows.length;
    var dirtyFlows = this.dirtyFlows;
    var constraintFlows = this.constraintFlows;
    var refreshes = [];
    for (var flowIx = 0; flowIx < numFlows; flowIx++) {
      if (dirtyFlows[flowIx] === true) {
        dirtyFlows[flowIx] = false;
        var startTime = now();
        flows[flowIx].refresh(this);
        if ((constraintFlows[flowIx] === true) && !(stores[flowIx].isEmpty()))  {
          console.error("Error flow " + JSON.stringify(this.ixToName[flowIx]) + " produced " + JSON.stringify(stores[flowIx].getFacts()), this);
        }
        var endTime = now();
        refreshes.push([tick, startTime, endTime, flowIx]);
        flowIx = 0; // resets the loop
      }
    }
    this.updateTable("refresh", refreshes, []);
    this.tick++;
    return this;
  },

  recompile: function(program) {
    var tables = this.getDump("table");
    var fields = this.getDump("field");
    var rules = this.getDump("rule");
    var valves = this.getDump("valve");
    var pipes = this.getDump("pipe");
    var tableConstraints = this.getDump("tableConstraint");
    var constantConstraints = this.getDump("constantConstraint");
    var functionConstraints = this.getDump("functionConstraint");
    var functionConstraintInputs = this.getDump("functionConstraintInput");
    var limitValves = this.getDump("limitValve");
    var ordinalValves = this.getDump("ordinalValve");
    var groupValves = this.getDump("groupValve");
    var sortValves = this.getDump("sortValve");
    var reducers = this.getDump("reducer");
    var constraintRules = this.getDump("constraintRule");

    rules.sort(function (a,b) { if (a.ix < b.ix) return 1; else return -1;});

    var stores = [];
    var flows = [];
    var dirtyFlows = [];
    var constraintFlows = [];
    var nameToIx = {};
    var downstream = [];

    var valveRules = {};
    var valveIxes = {};
    var numVars = {};
    var fieldIxes = {};
    var numFields = {};
    var pipeTables = {};
    for (var i = valves.length - 1; i >= 0; i--) {
      var valve = valves[i];
      valveRules[valve.valve] = valve.rule;
      valveIxes[valve.valve] = valve.ix;
      numVars[valve.rule] = (numVars[valve.rule] || 0) + 1;
    }
    for (var i = reducers.length - 1; i >= 0; i--) {
      var reducer = reducers[i];
      numVars[reducer.rule] = numVars[reducer.rule] - 1;
    }
    for (var i = ordinalValves.length - 1; i >= 0; i--) {
      var ordinalValve = ordinalValves[i];
      numVars[ordinalValve.rule] = numVars[ordinalValve.rule] - 1;
    }
    for (var i = fields.length - 1; i >= 0; i--) {
      var field = fields[i];
      fieldIxes[field.table + "-" + field.field] = field.ix;
      numFields[field.table] = (numFields[field.table] || 0) + 1;
    }
    for (var i = pipes.length - 1; i >= 0; i--) {
      var pipe = pipes[i];
      pipeTables[pipe.pipe] = pipe.table;
    }

    // choose flow ordering
    var upstream = {};
    var nextIx = 0;
    var flowFacts = [];
    var tablePlaced = {};
    for (var i = rules.length - 1; i >= 0; i--) {
      var rule = rules[i];
      upstream[rule.rule] = [];
    }
    for (var i = pipes.length - 1; i >= 0; i--) {
      var pipe = pipes[i];
      if ((pipe.direction === "+source") || (pipe.direction === "-source")) {
        upstream[pipe.rule].push(pipe.table);
      }
    }
    for (var i = rules.length - 1; i >= 0; i--) {
      var rule = rules[i];
      var ruleUpstream = upstream[rule.rule];
      for (var j = ruleUpstream.length - 1; j >= 0; j--) {
        var table = ruleUpstream[j];
        if (tablePlaced[table] !== true) {
          var sourceIx = nextIx++;
          nameToIx[table + "-source"] = sourceIx;
          flowFacts.push([sourceIx, "source", table]);
          var sinkIx = nextIx++;
          nameToIx[table + "-sink"] = sinkIx;
          flowFacts.push([sinkIx, "sink", table]);
          tablePlaced[table] = true;
        }
      }
      var solverIx = nextIx++;
      nameToIx[rule.rule + "-solver"] = solverIx;
      flowFacts.push([solverIx, "solver", rule.rule]);
      var aggregateIx = nextIx++;
      nameToIx[rule.rule + "-aggregate"] = aggregateIx;
      flowFacts.push([aggregateIx, "aggregate", rule.rule]);
    }
    for (var i = tables.length - 1; i >= 0; i--) {
      var table = tables[i];
      if (tablePlaced[table.table] !== true) {
          var sourceIx = nextIx++;
          nameToIx[table.table + "-source"] = sourceIx;
          flowFacts.push([sourceIx, "source", table.table]);
          var sinkIx = nextIx++;
          nameToIx[table.table + "-sink"] = sinkIx;
          flowFacts.push([sinkIx, "sink", table.table]);
      }
    }

    // build solvers and aggregates
    var solvers = {};
    var aggregates = {};
    for (var i = rules.length - 1; i >= 0; i--) {
      var rule = rules[i];

      var solverIx = nameToIx[rule.rule + "-solver"];
      var aggregateIx = nameToIx[rule.rule + "-aggregate"];

      var solver = Solver.empty(numVars[rule.rule], [], [], solverIx);
      solvers[rule.rule] = solver;
      stores[solverIx] = Memory.empty();
      flows[solverIx] = solver;
      dirtyFlows[solverIx] = true;
      downstream[solverIx] = [aggregateIx];

      var aggregate = Aggregate.empty([], [], undefined, undefined, [], [], [], solverIx, aggregateIx);
      aggregates[rule.rule] = aggregate;
      stores[aggregateIx] = Memory.empty();
      flows[aggregateIx] = aggregate;
      dirtyFlows[aggregateIx] = true;
      downstream[aggregateIx] = [];
    }

    // build sinks
    var sinks = {};
    for (var i = tables.length - 1; i >= 0; i--) {
      var table = tables[i];

      var sourceIx = nameToIx[table.table + "-source"];
      var sinkIx = nameToIx[table.table + "-sink"];
      var sinkFieldIxes = [];
      for (var j = numFields[table.table] - 1; j >= 0; j--) {
        sinkFieldIxes[j] = j;
      }

      stores[sourceIx] = this.stores[this.nameToIx[table.table + "-source"]] || Memory.empty();
      dirtyFlows[sourceIx] = false;
      downstream[sourceIx] = [sinkIx];

      var sink = new Sink([new SinkConstraint(sourceIx, sinkFieldIxes)], sinkIx);
      sinks[table.table] = sink;
      stores[sinkIx] = this.stores[this.nameToIx[table.table + "-sink"]] || Memory.empty();
      flows[sinkIx] = sink;
      dirtyFlows[sinkIx] = true;
      downstream[sinkIx] = [];
    }


    // build table constraints
    var constraints = {};
    for (var i = pipes.length - 1; i >= 0; i--) {
      var pipe = pipes[i];
      if (pipe.direction === "+source") {
        var constraint = new MemoryConstraint(nameToIx[pipe.table + "-sink"], []);
        solvers[pipe.rule].constraints.push(constraint);
        constraints[pipe.pipe] = constraint;
        downstream[nameToIx[pipe.table + "-sink"]].push(nameToIx[pipe.rule + "-solver"]);
      } else if (pipe.direction === "-source") {
        var constraint = new NegatedMemoryConstraint(nameToIx[pipe.table + "-sink"], []);
        solvers[pipe.rule].constraints.push(constraint);
        constraints[pipe.pipe] = constraint;
        downstream[nameToIx[pipe.table + "-sink"]].push(nameToIx[pipe.rule + "-solver"]);
      } else if (pipe.direction === "+sink") {
        var constraint = new SinkConstraint(nameToIx[pipe.rule + "-aggregate"], []);
        sinks[pipe.table].constraints.push(constraint);
        constraints[pipe.pipe] = constraint;
        downstream[nameToIx[pipe.rule + "-aggregate"]].push(nameToIx[pipe.table + "-sink"]);
      }
    }
    for (var i = tableConstraints.length - 1; i >= 0; i--) {
      var tableConstraint = tableConstraints[i];
      var fieldIx = fieldIxes[pipeTables[tableConstraint.pipe] + "-" + tableConstraint.field];
      var valveIx = valveIxes[tableConstraint.valve];
      constraints[tableConstraint.pipe].fieldIxes[fieldIx] = valveIx;
    }

    // build constant constraints
    for (var i = constantConstraints.length - 1; i >= 0; i--) {
      var constantConstraint = constantConstraints[i];
      var solver = solvers[valveRules[constantConstraint.valve]];
      solver.constants[valveIxes[constantConstraint.valve]] = constantConstraint.value;
    }

    // build function constraints
    for (var i = functionConstraints.length - 1; i >= 0; i--) {
      var functionConstraint = functionConstraints[i];
      var outIx = valveIxes[functionConstraint.valve];
      var constraint = new FunctionConstraint(undefined, [], [], outIx);
      solvers[functionConstraint.rule].constraints.push(constraint);
      constraints[functionConstraint.function] = constraint;
    }
    for (var i = functionConstraintInputs.length - 1; i >= 0; i--) {
      var functionConstraintInput = functionConstraintInputs[i];
      var constraint = constraints[functionConstraintInput.function];
      constraint.args.push(functionConstraintInput.variable);
      constraint.inIxes.push(valveIxes[functionConstraintInput.valve]);
      constraint.inValues.push(null);
    }
    for (var i = functionConstraints.length - 1; i >= 0; i--) {
      var functionConstraint = functionConstraints[i];
      var constraint = constraints[functionConstraint.function];
      constraint.fun = Function.apply(null, constraint.args.concat(["return (" + functionConstraint.code + ");"]));
    }

    // fill in aggregates
    for (var i = limitValves.length - 1; i >= 0; i--) {
      var limitValve = limitValves[i];
      var aggregate = aggregates[limitValve.rule];
      aggregate.limitIx = valveIxes[limitValve.valve];
    }
    for (var i = ordinalValves.length - 1; i >= 0; i--) {
      var ordinalValve = ordinalValves[i];
      var aggregate = aggregates[ordinalValve.rule];
      aggregate.ordinalIx = valveIxes[ordinalValve.valve];
    }
    for (var i = groupValves.length - 1; i >= 0; i--) {
      var groupValve = groupValves[i];
      var aggregate = aggregates[groupValve.rule];
      aggregate.groupIxes.push(valveIxes[groupValve.valve]);
    }
    for (var i = sortValves.length - 1; i >= 0; i--) {
      var sortValve = sortValves[i];
      var aggregate = aggregates[sortValve.rule];
      aggregate.sortIxes[sortValve.ix] = valveIxes[sortValve.valve];
    }
    for (var i = reducers.length - 1; i >= 0; i--) {
      var reducer = reducers[i];
      var aggregate = aggregates[reducer.rule];
      aggregate.reducerInIxes.push(valveIxes[reducer.inValve]);
      aggregate.reducerOutIxes.push(valveIxes[reducer.outValve]);
      aggregate.reducerFuns.push(Function.apply(null, [reducer.inVariable, "return (" + reducer.code + ");"]));
    }

    for (var i = constraintRules.length - 1; i >= 0; i--) {
      var constraintRule = constraintRules[i];
      constraintFlows[nameToIx[constraintRule.rule + "-aggregate"]] = true;
    }

    var ixToName = [];
    for (var name in nameToIx) {
      ixToName[nameToIx[name]] = name;
    }

    this.stores = stores;
    this.flows = flows;
    this.dirtyFlows = dirtyFlows;
    this.constraintFlows = constraintFlows;
    this.downstream = downstream;
    this.nameToIx = nameToIx;
    this.ixToName = ixToName;
    this.setStore(nameToIx["flow-source"], Memory.fromFacts(flowFacts));

    return this;
  },

  // for testing

  update: function(adds, dels) {
    // console.log(system);
    var addGroups = {};
    var delGroups = {};
    for (var i = adds.length - 1; i >= 0; i--) {
      var add = adds[i];
      var group = addGroups[add[0]] || (addGroups[add[0]] = []);
      group.push(add.slice(1));
    }
    for (var i = dels.length - 1; i >= 0; i--) {
      var del = dels[i];
      var group = delGroups[del[0]] || (delGroups[del[0]] = []);
      group.push(del.slice(1));
    }
    for (var table in addGroups) {
      this.updateTable(table, addGroups[table], []);
    }
    for (var table in delGroups) {
      this.updateTable(table, [], delGroups[table]);
    }
    return this;
  },

  testTable: function(table, facts) {
    var outputAdds = [];
    var outputDels = [];
    diffFacts(this.getTable(table).facts, facts, outputAdds, outputDels);
    if ((outputAdds.length > 0) || (outputDels.length > 0)) {
      console.error(this);
      throw new Error("In '" + this.meta.name + "' table '" + table + "' has " + JSON.stringify(outputDels) + " and the test expects " + JSON.stringify(outputAdds));
    }
    return this;
  },

  test: function(facts) {
    var groups = {};
    for (var i = facts.length - 1; i >= 0; i--) {
      var fact = facts[i];
      var group = groups[fact[0]] || (groups[fact[0]] = []);
      group.push(fact.slice(1));
    }
    for (var table in groups) {
      this.testTable(table, groups[table]);
    }
    return this;
  }
};

// ADAM

function program() { // name, rule*
  var name = arguments[0];
  var declarations = Array.prototype.slice.call(arguments, 1).concat(compilerConstraints);
  var facts = [];
  var context = {nextId: 0,
                 rule: null,
                 valves: null};
  for (var i = 0; i < declarations.length; i++) {
    facts = facts.concat(declarations[i](context));
  }
  return System.empty({name: name}).update(facts, []).refresh().recompile();
}

function table(table, fields) {
  return function (context) {
    var facts = [["table", table]];
    if(context.program) {
      facts.push(["programTable", context.program, table]);
    }
    for (var i = fields.length - 1; i >= 0; i--) {
      facts.push(["field", table, fields[i], i]);
    }
    return facts;
  };
}

function rule() { // name, clause*
  var args = arguments;
  return function (context) {
    context.rule = args[0];
    var facts = [["rule", context.rule, context.nextId++],
                 ["editorRule", context.rule, context.rule]];
    if(context.program) {
      facts.push(["programRule", context.program, context.rule]);
    }

    for (var i = 1; i < args.length; i++) {
      facts = facts.concat(args[i](context));
    }
    var valves = {};
    for (var i = facts.length - 1; i >= 0; i--) {
      var fact = facts[i];
      if (fact[0] === "tableConstraint") valves[fact[1]] = true;
      if (fact[0] === "constantConstraint") valves[fact[1]] = true;
      if (fact[0] === "functionConstraint") valves[fact[3]] = true;
      if (fact[0] === "reducer") valves[fact[3]] = false;
      if (fact[0] === "ordinalValve") valves[fact[2]] = false;
    }
    var ix = 0;
    for (var valve in valves) {
      if (valves[valve] === true) facts.push(["valve", valve, context.rule, ix++]);
    }
    for (var valve in valves) {
      if (valves[valve] === false) facts.push(["valve", valve, context.rule, ix++]);
    }
    return facts;
  };
}

function constraint() { // name, clause*
  var args = arguments;
  return function(context) {
    var facts = rule.apply(null, args)(context);
    facts.push(["constraintRule", args[0]]);
    return facts;
  }
}

function foreignKey(fromTable, fromField, toTable, toField) {
  var fromBindings = {};
  fromBindings[fromField] = "field";
  var toBindings = {};
  toBindings[toField] = "field";
  return constraint("foreignKey: " + fromTable + "." + fromField + " = " + toTable + "." + toField,
                    source(fromTable, fromBindings),
                    notSource(toTable, toBindings));
}

function pipe(direction, table, bindings) {
  return function (context) {
    var pipe = context.rule + "|table=" + table + "|" + context.nextId++;
    var facts = [["pipe", pipe, table, context.rule, direction]];
    for (var field in bindings) {
      var valve = context.rule + "|variable=" + bindings[field];
      facts.push(["tableConstraint", valve, pipe, field]);
    }
    return facts;
  };
}

function source(table, bindings) {
  return pipe("+source", table, bindings);
}

function notSource(table, bindings) {
  return pipe("-source", table, bindings);
}

function sink(table, bindings) {
  return pipe("+sink", table, bindings);
}

function constant(variable, value) {
  if(typeof value === "object") throw new Error("object passed as constant");
  return function(context) {
    var valve = context.rule + "|variable=" + variable;
    return [["constantConstraint", valve, value]];
  };
}

function calculate(outputVariable, inputVariables, code) {
  return function(context) {
    var functionConstraint = context.rule + "|function=" + outputVariable + "|" + context.nextId++;
    var facts = [];
    var outputValve = context.rule + "|variable=" + outputVariable;
    for (var i = inputVariables.length - 1; i >= 0; i--) {
      var inputVariable = inputVariables[i];
      var inputValve = context.rule + "|variable=" + inputVariable;
      facts.push(["functionConstraintInput", functionConstraint, inputValve, inputVariable]);
    }
    facts.push(["functionConstraint", functionConstraint, code, outputValve, context.rule]);
    return facts;
  };
}

function aggregate(groupVariables, sortVariables, limit, ordinal) {
  return function(context) {
    var facts = [];
    for (var i = groupVariables.length - 1; i >= 0; i--) {
      var variable = groupVariables[i];
      var valve = context.rule + "|variable=" + variable;
      facts.push(["groupValve", context.rule, valve]);
    }
    for (var i = sortVariables.length - 1; i >= 0; i--) {
      var variable = sortVariables[i];
      var valve = context.rule + "|variable=" + variable;
      facts.push(["sortValve", context.rule, valve, i]);
    }
    if (typeof(limit) === "number") {
      var valve = context.rule + "|limit";
      facts.push(["constantConstraint", valve, limit],
                 ["limitValve", context.rule, valve]);
    }
    if (typeof(limit) === "string") {
      var valve = context.rule + "|variable=" + limit;
      facts.push(["limitValve", context.rule, valve]);
    }
    if (typeof(ordinal) === "string") {
      var valve = context.rule + "|variable=" + ordinal;
      facts.push(["ordinalValve", context.rule, valve]);
    }
    return facts;
  };
}

function reduce(outputVariable, inputVariable, code) {
  return function(context) {
    var outputValve = context.rule + "|variable=" + outputVariable;
    var inputValve = context.rule + "|variable=" + inputVariable;
    return [["reducer", context.rule, inputValve, outputValve, inputVariable, code]];
  };
}

function compose() {
  var args = arguments;
  return function(context) {
    var facts = [];
    for(var i = 0; i < args.length; i++) {
      var cur = args[i];
      Array.prototype.push.apply(facts, cur(context));
    }
    return facts;
  };
}

function concat(context, facts, toAdd, isChild) {
  Array.prototype.push.apply(facts, toAdd(context, isChild));
}

function inject(field) {
  return function(context, isChild) {
    if(!isChild) {
      return field;
    } else {
      var facts = [];
      if(!context.uiParent) throw new Error("No parent provided: " + JSON.stringify(context));
      //auto-generate an id
      var id = "elemId" + context.nextId++;
      concat(context, facts, calculate(id, [context.uiParent], context.uiParent + " + '_" + context.uiIx + "'"));
      concat(context, facts, sink("uiText", {id: id, text: field}));
      context.uiChildId = id;
      return facts;
    }
  };
}

function constantOrField(context, facts, thing) {
  if(typeof thing === "function") {
    return thing(context);
  } else {
    var id = "const" + context.nextId++;
    concat(context, facts, constant(id, thing));
    return id;
  }
}

var uiEventNames = {
  "click": "click",
  "doubleClick": "dblclick",
  "contextMenu": "contextMenu",
  "input": "input",
  "drag": "drag",
  "drop": "drop",
  "dragStart": "dragstart",
  "dragEnd": "dragend",
  "dragOver": "dragover"
};

function elem() {
  var args = arguments;
  return function(context) {
    var facts = [];
    var id;
    if(args[1] && args[1]["id"]) {
      //this is our id
      id = constantOrField(context, facts, args[1]["id"]);
    } else {
      if(!context.uiParent) throw new Error("No parent provided: " + JSON.stringify(context));
      //auto-generate an id
      var id = "elemId" + context.nextId++;
      concat(context, facts, calculate(id, [context.uiParent], context.uiParent + " + '_" + context.uiIx + "'"));
    }


    //uiElem
    var tag = constantOrField(context, facts, args[0]);
    concat(context, facts, sink("uiElem", {"id": id, "type": tag}));

    //uiAttr
    var attrs = args[1];
    if(attrs) {
      for(var attrKey in attrs) {
        var attrValue = attrs[attrKey];
        if(attrKey === "id" || attrKey === "parent") {
          continue;
        } else if(attrKey === "style") {
          for(var styleKey in attrValue) {
            var styleValue = attrValue[styleKey];
            var value = constantOrField(context, facts, styleValue);
            var attr = constantOrField(context, facts, styleKey);
            concat(context, facts, sink("uiStyle", {"id": id, "attr": attr, "value": value}));
          }
        } else if(uiEventNames[attrKey]) {
          var event = constantOrField(context, facts, uiEventNames[attrKey]);
          var label = constantOrField(context, facts, attrValue[0]);
          var key = constantOrField(context, facts, attrValue[1]);
          concat(context, facts, sink("uiEvent", {"id": id, "event": event, "label": label, "key": key}));
        } else {
          var value = constantOrField(context, facts, attrValue);
          var attr = constantOrField(context, facts, attrKey);
          concat(context, facts, sink("uiAttr", {"id": id, "attr": attr, "value": value}));
        }
      }
    }

    //uiChild
    if(attrs && attrs["parent"]) {
      var parent = attrs["parent"];
      var parentId = constantOrField(context, facts, parent[0]);
      var childPos = constantOrField(context, facts, parent[1] || 0);
      concat(context, facts, sink("uiChild", {"parent": parentId, "child": id, "pos": childPos}));
    }
    for(var childIx = 2; childIx < args.length; childIx++) {
      var curChild = args[childIx];
      context.uiParent = id;
      context.uiIx = childIx - 2;
      if(typeof curChild === "function") {
        //we have either an element or an injection
        concat(context, facts, curChild, true);
      } else if(typeof curChild === "string") {
        //we have raw text
        var textId = "elemId" + context.nextId++;
        var text = constantOrField(context, facts, curChild);
        concat(context, facts, calculate(textId, [context.uiParent], context.uiParent + " + '_" + context.uiIx + "'"));
        concat(context, facts, sink("uiText", {id: textId, text: text}));
        context.uiChildId = textId;
      }

      //add uiChild entry
      var childPos = constantOrField(context, facts, childIx);
      concat(context, facts, sink("uiChild", {"parent": id, "child": context.uiChildId, "pos": childPos}));

    }
    context.uiChildId = id;
    context.uiParent = false;
    context.uiIx = false;

    return facts;
  };
}

// COMPILER CONSTRAINTS
var compilerConstraints = [
  foreignKey("field", "table", "table", "table"),
  foreignKey("valve", "rule", "rule", "rule"),
  foreignKey("pipe", "table", "table", "table"),
  foreignKey("pipe", "rule", "rule", "rule"),
  foreignKey("tableConstraint", "pipe", "pipe", "pipe"),
  foreignKey("tableConstraint", "valve", "valve", "valve"),
  constraint("fields in rules match fields in tables",
             source("tableConstraint", {valve: "valve", pipe: "pipe", field: "field"}),
             source("pipe", {pipe: "pipe", table: "table"}),
             notSource("field", {table: "table", field: "field"})),
  foreignKey("constantConstraint", "valve", "valve", "valve"),
  foreignKey("functionConstraint", "valve", "valve", "valve"),
  foreignKey("functionConstraint", "rule", "rule", "rule"),
  foreignKey("functionConstraintInput", "function", "functionConstraint", "function"),
  foreignKey("functionConstraintInput", "valve", "valve", "valve"),
  foreignKey("limitValve", "rule", "rule", "rule"),
  foreignKey("limitValve", "valve", "valve", "valve"),
  foreignKey("ordinalValve", "rule", "rule", "rule"),
  foreignKey("ordinalValve", "valve", "valve", "valve"),
  foreignKey("groupValve", "rule", "rule", "rule"),
  foreignKey("groupValve", "valve", "valve", "valve"),
  foreignKey("sortValve", "rule", "rule", "rule"),
  foreignKey("sortValve", "valve", "valve", "valve"),
  foreignKey("reducer", "rule", "rule", "rule"),
  foreignKey("reducer", "inValve", "valve", "valve"),
  foreignKey("reducer", "outValve", "valve", "valve"),
  foreignKey("refresh", "flow", "flow", "flow"),
  foreignKey("constraintRule", "rule", "rule", "rule"),


  constraint("all valves are constrained",
             source("valve", {valve: "valve"}),
             notSource("tableConstraint", {valve: "valve"}),
             notSource("constantConstraint", {valve: "valve"}),
             notSource("functionConstraint", {valve: "valve"}),
             notSource("reducer", {outValve: "valve"}))
  ];
