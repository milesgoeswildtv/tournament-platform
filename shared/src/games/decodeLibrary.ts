export interface DecodePuzzle {
  answer: string;
  category: string;
  clues: [string, string];
  /** Extra accepted spellings (normalised before comparison). */
  accept?: string[];
}

/** Controlled puzzle library. Phrases are common English expressions and place names. */
export const DECODE_PUZZLES: DecodePuzzle[] = [
  { answer: 'BREAK THE ICE', category: 'Phrase', clues: ['What you do with strangers at the start of a party.', 'Frozen water, cracked.'] },
  { answer: 'SPILL THE BEANS', category: 'Phrase', clues: ['Reveal a secret.', 'A legume accident.'] },
  { answer: 'BITE THE BULLET', category: 'Phrase', clues: ['Face something painful head-on.', 'Teeth meet ammunition.'] },
  { answer: 'UNDER THE WEATHER', category: 'Phrase', clues: ['Feeling a bit sick.', 'Beneath the forecast.'] },
  { answer: 'HIT THE SACK', category: 'Phrase', clues: ['Go to bed.', 'Punch a bag.'] },
  { answer: 'ON THIN ICE', category: 'Phrase', clues: ['One mistake away from trouble.', 'A risky frozen surface.'] },
  { answer: 'CUT CORNERS', category: 'Phrase', clues: ['Do the job cheaply or lazily.', 'A square loses its edges.'] },
  { answer: 'THE LAST STRAW', category: 'Phrase', clues: ['The final thing that makes you snap.', 'It broke the camel’s back.'] },
  { answer: 'BACK TO SQUARE ONE', category: 'Phrase', clues: ['Start over from the beginning.', 'Return to the first box.'] },
  { answer: 'BURN THE MIDNIGHT OIL', category: 'Phrase', clues: ['Work late into the night.', 'A lamp still lit at 12.'] },
  { answer: 'CALL IT A DAY', category: 'Phrase', clues: ['Stop working for now.', 'Name the twenty-four hours.'] },
  { answer: 'IN THE SAME BOAT', category: 'Phrase', clues: ['Facing the same problem together.', 'Shared vessel.'] },
  { answer: 'PIECE OF CAKE', category: 'Phrase', clues: ['Very easy.', 'A dessert slice.'] },
  { answer: 'BLESSING IN DISGUISE', category: 'Phrase', clues: ['Bad luck that turns out good.', 'Good fortune wearing a mask.'] },
  { answer: 'NO PAIN NO GAIN', category: 'Phrase', clues: ['Gym motto.', 'Suffering earns progress.'] },
  { answer: 'GREAT WALL OF CHINA', category: 'Place', clues: ['Ancient fortification in Asia.', 'Thousands of kilometres of stone.'] },
  { answer: 'GRAND CANYON', category: 'Place', clues: ['Carved by the Colorado River.', 'Arizona’s famous gorge.'] },
  { answer: 'MOUNT EVEREST', category: 'Place', clues: ['Earth’s highest peak above sea level.', 'On the Nepal–China border.'] },
  { answer: 'SAHARA DESERT', category: 'Place', clues: ['Largest hot desert.', 'Covers much of North Africa.'] },
  { answer: 'NIAGARA FALLS', category: 'Place', clues: ['Waterfalls on the US–Canada border.', 'Honeymoon spot with a mist.'] },
  { answer: 'AMAZON RIVER', category: 'Place', clues: ['Flows through Brazil.', 'Huge South American waterway.'] },
  { answer: 'TRAFFIC CONE', category: 'Object', clues: ['Orange and white, marks roadwork.', 'Pointed plastic barrier.'] },
  { answer: 'FIRE ESCAPE', category: 'Object', clues: ['Metal stairs on the outside of a building.', 'Way out when there is smoke.'] },
  { answer: 'PAPER AIRPLANE', category: 'Object', clues: ['Folded and thrown across a classroom.', 'Flight from a sheet.'], accept: ['paper aeroplane', 'paper plane'] },
  { answer: 'LOADING DOCK', category: 'Place', clues: ['Where trucks back up to a warehouse.', 'Raised platform for freight.'] },
  { answer: 'VENDING MACHINE', category: 'Object', clues: ['Insert coins, get a snack.', 'Sometimes it eats your money.'] },
  { answer: 'SKELETON KEY', category: 'Object', clues: ['Opens many locks.', 'Bony name, metal body.'] },
  { answer: 'SHIPPING CONTAINER', category: 'Object', clues: ['Steel box stacked on cargo ships.', 'Twenty or forty feet long.'] },
  { answer: 'SPEED OF LIGHT', category: 'Science', clues: ['About 300,000 km per second.', 'Nothing travels faster.'] },
  { answer: 'BLACK HOLE', category: 'Science', clues: ['Not even light escapes it.', 'Collapsed star.'] },
  { answer: 'SOLAR ECLIPSE', category: 'Science', clues: ['The Moon blocks the Sun.', 'Daytime goes dark.'] },
  { answer: 'NORTHERN LIGHTS', category: 'Science', clues: ['Green ribbons in the Arctic sky.', 'Aurora borealis.'] },
  { answer: 'HOT SAUCE', category: 'Food', clues: ['A few drops make it spicy.', 'Chili in a bottle.'] },
  { answer: 'GRILLED CHEESE', category: 'Food', clues: ['Toasted sandwich, melted middle.', 'Pairs with tomato soup.'] },
  { answer: 'FRENCH FRIES', category: 'Food', clues: ['Deep-fried potato sticks.', 'Often served with ketchup.'], accept: ['fries', 'chips'] },
  { answer: 'MIDNIGHT SNACK', category: 'Food', clues: ['Food eaten very late.', 'A raid on the fridge at 12.'] },
  { answer: 'POWER OUTAGE', category: 'Event', clues: ['The lights go out across the block.', 'The grid fails.'], accept: ['power cut', 'blackout'] },
  { answer: 'HEAD START', category: 'Phrase', clues: ['An advantage at the beginning.', 'Leave before the others.'] },
  { answer: 'SECOND WIND', category: 'Phrase', clues: ['Sudden new energy when tired.', 'Breath, round two.'] },
  { answer: 'WILD CARD', category: 'Phrase', clues: ['An unpredictable factor.', 'Joker in the deck.'] },
];
