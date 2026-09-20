export const frozenScenarios = [
  ["S-1", "Thanks for staying late to fix the demo.", "recommendations"],
  ["S-2", "We shipped the release and all health checks are green.", "recommendations"],
  ["S-3", "I agree with the proposal. Let’s proceed.", "recommendations"],
  ["S-4", "I’m blocked on the test failure and could use help.", "recommendations"],
  ["S-5", "Could you review this design before tomorrow?", "recommendations"],
  ["S-6", "My teammate’s parent passed away.", "recommendations"],
  ["S-7", "I’m sorry I missed the deadline.", "recommendations"],
  ["S-8", "Okay…", "abstained"],
  ["S-9", "Great, another production outage. Exactly what we needed.", "recommendations"],
  ["S-10", "You are useless and should quit.", "abstained"],
  ["S-11", "The customer data may have been exposed.", "recommendations"],
  ["S-12", "The investigation is complete; please take a look.", "recommendations"]
] as const;
