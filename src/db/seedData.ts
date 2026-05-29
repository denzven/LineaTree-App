import { type TreeNode, type TreeEdge, db } from './indexedDB';

export interface SeedTemplate {
  name: string;
  description: string;
  nodes: TreeNode[];
  edges: TreeEdge[];
}

export const ROYAL_DYNASTY: SeedTemplate = {
  name: 'Royal Dynasty Pedigree',
  description: 'A 3-generation royal family tree tracking genetic lineages, successions, divorces, and complex modern-day estrangements.',
  nodes: [
    { id: 'k_george', type: 'INDIVIDUAL', name: 'King George V', sex: 'M', lifeStatus: 'DECEASED', dob: '1940-06-03', dod: '2022-09-08', job: 'Monarch', company: 'The Crown', traits: ['Hemophilia Carrier', 'Blue Eyes'] },
    { id: 'q_mary', type: 'INDIVIDUAL', name: 'Queen Mary', sex: 'F', lifeStatus: 'DECEASED', dob: '1942-04-21', dod: '2023-11-20', job: 'Queen Consort', company: 'The Crown', traits: ['Red Hair'] },
    
    { id: 'p_charles', type: 'INDIVIDUAL', name: 'King Charles III', sex: 'M', lifeStatus: 'ALIVE', dob: '1968-11-14', job: 'Sovereign', company: 'The Crown', traits: ['Gout', 'Blue Eyes'] },
    { id: 'p_diana', type: 'INDIVIDUAL', name: 'Princess Diana', sex: 'F', lifeStatus: 'DECEASED', dob: '1971-07-01', dod: '1997-08-31', job: 'Philanthropist', company: 'Red Cross', traits: ['Hyper-mobility', 'Blonde Hair'] },
    { id: 'c_camilla', type: 'INDIVIDUAL', name: 'Queen Camilla', sex: 'F', lifeStatus: 'ALIVE', dob: '1967-07-17', job: 'Queen Consort', company: 'The Crown', traits: ['Green Eyes'] },
    
    { id: 'p_anne', type: 'INDIVIDUAL', name: 'Princess Anne', sex: 'F', lifeStatus: 'ALIVE', dob: '1970-08-15', job: 'Princess Royal', company: 'The Crown', traits: ['Athletic'] },
    
    { id: 'p_william', type: 'INDIVIDUAL', name: 'Prince William', sex: 'M', lifeStatus: 'ALIVE', dob: '1982-06-21', job: 'Prince of Wales', company: 'The Crown', traits: ['Blue Eyes', 'Male-pattern Baldness'] },
    { id: 'p_harry', type: 'INDIVIDUAL', name: 'Prince Harry', sex: 'M', lifeStatus: 'ALIVE', dob: '1984-09-15', job: 'Duke of Sussex', company: 'Archewell', traits: ['Red Hair', 'Blue Eyes'] },
    { id: 'k_kate', type: 'INDIVIDUAL', name: 'Catherine Middleton', sex: 'F', lifeStatus: 'ALIVE', dob: '1982-01-09', job: 'Princess of Wales', company: 'The Crown', traits: ['Brunette Hair'] },
    { id: 'm_markle', type: 'INDIVIDUAL', name: 'Meghan Markle', sex: 'F', lifeStatus: 'ALIVE', dob: '1981-08-04', job: 'Duchess of Sussex', company: 'Archewell', traits: ['Freckles'] }
  ],
  edges: [
    // Generation 1 Marriages
    { id: 'e_gm_marriage', source: 'k_george', target: 'q_mary', type: 'SPOUSE' },
    
    // Generation 2 Parents
    { id: 'e_charles_parent1', source: 'k_george', target: 'p_charles', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_charles_parent2', source: 'q_mary', target: 'p_charles', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_anne_parent1', source: 'k_george', target: 'p_anne', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_anne_parent2', source: 'q_mary', target: 'p_anne', type: 'BIOLOGICAL_PARENT' },
    
    // Generation 2 Marriages & Divorces
    { id: 'e_charles_diana', source: 'p_charles', target: 'p_diana', type: 'DIVORCED' },
    { id: 'e_charles_camilla', source: 'p_charles', target: 'c_camilla', type: 'SPOUSE' },
    
    // Generation 3 Parents
    { id: 'e_will_p1', source: 'p_charles', target: 'p_william', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_will_p2', source: 'p_diana', target: 'p_william', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_harry_p1', source: 'p_charles', target: 'p_harry', type: 'BIOLOGICAL_PARENT' },
    { id: 'e_harry_p2', source: 'p_diana', target: 'p_harry', type: 'BIOLOGICAL_PARENT' },
    
    // Generation 3 Marriages
    { id: 'e_will_kate', source: 'p_william', target: 'k_kate', type: 'SPOUSE' },
    { id: 'e_harry_meghan', source: 'p_harry', target: 'm_markle', type: 'SPOUSE' },
    
    // Social & Friction Overlays
    { id: 'e_will_harry_friends', source: 'p_william', target: 'p_harry', type: 'FRIEND' },
    { id: 'e_harry_charles_estran', source: 'p_harry', target: 'p_charles', type: 'ESTRANGED' },
    { id: 'e_diana_camilla_estran', source: 'p_diana', target: 'c_camilla', type: 'ESTRANGED' },
    { id: 'e_harry_kate_class', source: 'p_harry', target: 'k_kate', type: 'CLASSMATE' }
  ]
};

export const MEDICAL_GENOGRAM: SeedTemplate = {
  name: 'Medical Genogram Network',
  description: 'A clinical layout showcasing high-risk genetic carriers (BRCA1 mutation, Hemophilia), biological overlays, and non-genetic neighbors.',
  nodes: [
    { id: 'g_arthur', type: 'INDIVIDUAL', name: 'Arthur Bennett', sex: 'M', lifeStatus: 'DECEASED', dob: '1938-05-12', dod: '2015-08-24', job: 'Steelworker', company: 'Bethlehem Steel', traits: ['Hypertension', 'Color Blindness'] },
    { id: 'g_beatrice', type: 'INDIVIDUAL', name: 'Beatrice Bennett', sex: 'F', lifeStatus: 'DECEASED', dob: '1941-11-02', dod: '2020-03-14', job: 'Schoolteacher', company: 'Public Schools', traits: ['BRCA1 Carrier', 'Type II Diabetes'] },
    
    { id: 'f_bob', type: 'INDIVIDUAL', name: 'Robert Bennett', sex: 'M', lifeStatus: 'ALIVE', dob: '1965-02-18', job: 'Software Lead', company: 'Tech Corp', traits: ['Hypertension'] },
    { id: 'm_brenda', type: 'INDIVIDUAL', name: 'Brenda Vance', sex: 'F', lifeStatus: 'ALIVE', dob: '1967-09-22', job: 'Architect', company: 'Vance Design', traits: ['BRCA1 Carrier', 'Migraines'] },
    { id: 'a_barbara', type: 'INDIVIDUAL', name: 'Barbara Vance', sex: 'F', lifeStatus: 'ALIVE', dob: '1969-12-05', job: 'Pharmacist', company: 'CVS', traits: ['BRCA1 Carrier'] },
    
    { id: 'c_chris', type: 'INDIVIDUAL', name: 'Christopher Bennett', sex: 'M', lifeStatus: 'ALIVE', dob: '1995-07-14', job: 'Data Analyst', company: 'Health Systems', traits: ['Hypertension', 'Color Blindness'] },
    { id: 'c_debbie', type: 'INDIVIDUAL', name: 'Deborah Bennett', sex: 'F', lifeStatus: 'ALIVE', dob: '1998-10-30', job: 'Medical Student', company: 'State Med', traits: ['Type II Diabetes'] },
    { id: 'c_emma', type: 'INDIVIDUAL', name: 'Emma Bennett', sex: 'INTERSEX', lifeStatus: 'ALIVE', dob: '2001-03-05', job: 'Student', company: 'State College', traits: ['BRCA1 Carrier', 'Asthma'] }
  ],
  edges: [
    // Gen 1 marriage
    { id: 'm_arthur_beatrice', source: 'g_arthur', target: 'g_beatrice', type: 'CONSANGUINOUS' },
    
    // Gen 2 parents
    { id: 'p_bob_arthur', source: 'g_arthur', target: 'f_bob', type: 'BIOLOGICAL_PARENT' },
    { id: 'p_bob_beatrice', source: 'g_beatrice', target: 'f_bob', type: 'BIOLOGICAL_PARENT' },
    
    // Gen 2 Marriage
    { id: 'm_bob_brenda', source: 'f_bob', target: 'm_brenda', type: 'SPOUSE' },
    
    // Gen 3 Parents
    { id: 'p_chris_bob', source: 'f_bob', target: 'c_chris', type: 'BIOLOGICAL_PARENT' },
    { id: 'p_chris_brenda', source: 'm_brenda', target: 'c_chris', type: 'BIOLOGICAL_PARENT' },
    
    { id: 'p_emma_bob', source: 'f_bob', target: 'c_emma', type: 'BIOLOGICAL_PARENT' },
    { id: 'p_emma_brenda', source: 'm_brenda', target: 'c_emma', type: 'BIOLOGICAL_PARENT' },
    
    // Gen 3 Adoptive
    { id: 'p_debbie_foster', source: 'f_bob', target: 'c_debbie', type: 'ADOPTIVE_PARENT' },
    { id: 'p_debbie_brenda', source: 'm_brenda', target: 'c_debbie', type: 'ADOPTIVE_PARENT' },
    
    // Sister adoption connection
    { id: 'p_debbie_barbara_foster', source: 'a_barbara', target: 'c_debbie', type: 'FOSTER_PARENT' },
    
    // Social overlaps
    { id: 'e_bob_barbara_coworkers', source: 'f_bob', target: 'a_barbara', type: 'COWORKER' },
    { id: 'e_brenda_barbara_class', source: 'm_brenda', target: 'a_barbara', type: 'CLASSMATE' },
    { id: 'e_chris_debbie_neighbors', source: 'c_chris', target: 'c_debbie', type: 'NEIGHBOR' }
  ]
};

export const TEMPLATES = [ROYAL_DYNASTY, MEDICAL_GENOGRAM];

export async function loadTemplateIntoIndexedDB(template: SeedTemplate) {
  await db.transaction('rw', [db.nodes, db.edges, db.images], async () => {
    // Clear existing database collections
    await db.nodes.clear();
    await db.edges.clear();
    await db.images.clear();

    // Populate data
    await db.nodes.bulkAdd(template.nodes);
    await db.edges.bulkAdd(template.edges);
  });
}
