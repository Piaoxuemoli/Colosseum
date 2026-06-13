# Line 349: Convert pendingDecisions.add() to start of try block
349s/pendingDecisions.add(decisionKey)/pendingDecisions.add(decisionKey)\n      try {/

# Line 395+: Add finally block after pendingDecisions.delete
# We need to find the last section before the nextPlayer check and wrap it
