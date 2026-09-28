/**
 * The standard, class by class.
 *
 * The first test is the whole phase in one assertion: the worked example from the analysis, with
 * its four sections, reproducing its nine ranges and nothing else. Everything after it takes one
 * rule at a time and shows both halves — what earns a mark, and what deliberately does not. A
 * detector that only ever says yes would pass half of this file.
 */
import { describe, expect, it } from 'vitest';
import { EXECUTION_VERB, ALWAYS_ESCALATE_PATTERN } from './safety-sendability.js';
import {
  classifyPromptEnhancementEmphasisCandidatesV1,
  type PromptEnhancementEmphasisCandidateV1,
  type PromptEnhancementEmphasisInputV1,
} from './emphasis-classes.js';

const NAMED_ACTION = 'production release or rollout';
const CONFIRMATION = `Still, before you do this ${NAMED_ACTION} you must ask me for go-ahead confirmation, and before you ask, confirm the actual state at ground level by reading the real source. Do not assume, and do not rely on what you did earlier in this session.`;
const STANCE = 'This request touches something risky the developer has not asked to have done: cover what to check and what to confirm with them first, rather than carrying it out.';

/** Just the pairs, so an assertion reads as the standard rather than as an object dump. */
const pairs = (found: readonly PromptEnhancementEmphasisCandidateV1[]): [number, string][] =>
  found.map((candidate) => [candidate.emphasisClass, candidate.text]);

const classify = (input: PromptEnhancementEmphasisInputV1) => classifyPromptEnhancementEmphasisCandidatesV1(input);

/** One section, the shape most of these tests need. */
const one = (
  sectionText: string,
  extra: Partial<PromptEnhancementEmphasisInputV1['sections'][number]> = {},
  input: Partial<PromptEnhancementEmphasisInputV1> = {},
) => classify({
  originalPromptText: input.originalPromptText ?? 'do the work',
  sections: [{ sectionKind: 'context_and_constraints', sectionText, ...extra }],
  ...input,
});

describe('the worked example', () => {
  // The prompt the analysis walks through: execute-shaped, one risk kind, and an earlier session
  // turn that renders an expectation line.
  const PROMPT = "add rate limiting to the upload endpoint, don't touch auth, then roll it out to production";

  const found = classify({
    originalPromptText: PROMPT,
    sensitiveActionName: NAMED_ACTION,
    sections: [
      {
        sectionKind: 'context_and_constraints',
        sectionText: 'Limit applies to POST /api/upload only.\nDo not modify the auth middleware.',
        groundedFactValues: ['POST /api/upload', 'auth'],
      },
      {
        sectionKind: 'acceptance_or_output_expectation',
        sectionText:
          'what you said done means appears to be "uploads over the limit get a 429" (seen earlier this session) — confirm before relying on it.',
      },
      {
        sectionKind: 'verification_or_test_plan',
        sectionText: "I'll run the project's test suite before reporting done.",
        groundedFactValues: ["the project's test suite"],
      },
      { sectionKind: 'risk_safety_or_confirmation', sectionText: CONFIRMATION },
    ],
  });

  it('reproduces its nine ranges, and marks nothing else', () => {
    expect(pairs(found)).toEqual([
      [2, 'POST /api/upload'],
      [2, 'auth'],
      [3, 'only'],
      [3, 'Do not modify the auth middleware'],
      [2, 'uploads over the limit get a 429'],
      [1, "run the project's test suite"],
      [4, 'before reporting done'],
      [5, NAMED_ACTION],
      [3, 'Do not assume'],
    ]);
  });

  it('marks no heading — not one, including the risky section’s', () => {
    // The headings are not in what this module is handed, and that is the point: it is given the
    // body of a section, never its title, so a heading cannot be marked by construction.
    for (const heading of ['Context and constraints', 'What done looks like', 'How to verify', 'Risk, safety and confirmation']) {
      expect(found.some((candidate) => candidate.text.includes(heading))).toBe(false);
    }
  });

  it('ranks the instruction it found as a write', () => {
    expect(found.find((candidate) => candidate.emphasisClass === 1)?.isWriteVerb).toBe(true);
  });
});

describe('class 1 — the instruction the body gives', () => {
  const grounded = { groundedFactValues: ['the payment client'] };

  it('marks a write verb with its object', () => {
    expect(pairs(one("I'll deploy the payment client.", grounded)))
      .toContainEqual([1, 'deploy the payment client']);
  });

  it('marks a read verb too, and ranks it below a write', () => {
    const found = one("I'll review the payment client.", grounded);
    const action = found.find((candidate) => candidate.emphasisClass === 1);
    expect(action?.text).toBe('review the payment client');
    expect(action?.isWriteVerb).toBe(false);
  });

  it('marks a verb whose object traces to nothing — which it did NOT until 2026-09-28', () => {
    // ⏪ Nobody named a staging cluster, and this used to be refused: "a verb with an object nobody
    // named is the body inventing work". Measured over the recorded bodies, that rule found 47
    // instructions and threw them away, leaving seven in the whole corpus — a reader was being shown
    // almost nothing of what the body tells the agent to do.
    //
    // What replaced it is not nothing: the instruction must still be a verb at the head of its
    // clause with an object, it may not run past eight words, and no section may end up more than
    // half drawn heavy. The protection moved from WHOSE words to HOW MUCH of the paragraph.
    expect(pairs(one("I'll deploy the staging cluster.", grounded)))
      .toContainEqual([1, 'deploy the staging cluster']);
  });

  it('does NOT mark a verb that is not at the head of its clause', () => {
    // The body describing something, rather than instructing.
    expect(one('The release notes mention deploy steps for the payment client.', grounded)
      .some((candidate) => candidate.emphasisClass === 1)).toBe(false);
  });

  it('does NOT mark anything inside the developer’s own restated prompt', () => {
    const found = classify({
      originalPromptText: 'deploy the payment client',
      sections: [{
        sectionKind: 'original_request_or_goal',
        sectionText: "I'll deploy the payment client.",
        groundedFactValues: ['the payment client'],
      }],
    });
    expect(found).toEqual([]);
  });

  it('is off in a section the body was not cleared to propose the action in', () => {
    const found = one("I'll deploy the payment client.", { ...grounded, clearanceVerdict: 'not_proposed' });
    expect(found.some((candidate) => candidate.emphasisClass === 1)).toBe(false);
  });

  it('is off THERE only — a section with no verdict still marks its instruction', () => {
    // The rule is scoped to the risky kinds, so a verdict on one section must not silence another.
    const found = classify({
      originalPromptText: 'deploy the payment client',
      sections: [
        {
          sectionKind: 'risk_safety_or_confirmation',
          sectionText: "I'll deploy the payment client.",
          groundedFactValues: ['the payment client'],
          clearanceVerdict: 'not_proposed',
        },
        {
          sectionKind: 'verification_or_test_plan',
          sectionText: "I'll review the payment client.",
          groundedFactValues: ['the payment client'],
        },
      ],
    });
    expect(pairs(found.filter((candidate) => candidate.emphasisClass === 1)))
      .toEqual([[1, 'review the payment client']]);
  });

  it('is off when the body is not English, and the other classes stay on', () => {
    const found = classify({
      originalPromptText: 'deploy karo payment client',
      detectedLanguageSelfReport: 'hi-Latn',
      sections: [{
        sectionKind: 'context_and_constraints',
        sectionText: "I'll deploy the payment client. Do not touch auth.",
        groundedFactValues: ['the payment client'],
      }],
    });
    expect(found.some((candidate) => candidate.emphasisClass === 1)).toBe(false);
    expect(found.some((candidate) => candidate.emphasisClass === 3)).toBe(true);
  });
});

describe('class 2 — the developer’s own words', () => {
  it('comes from a floor item the developer wrote', () => {
    expect(pairs(one('Fix the failing test in src/api/upload.ts.', {}, {
      originalPromptText: 'fix the failing test in src/api/upload.ts',
    }))).toContainEqual([2, 'src/api/upload.ts']);
  });

  it('comes from a curated tool name', () => {
    expect(pairs(one('Cache reads go through Redis.', {}, { originalPromptText: 'use redis for the cache' })))
      .toContainEqual([2, 'Redis']);
  });

  it('comes from an expectation line’s value, and never its framing', () => {
    const found = one('node version appears to be 22 (from a recent project check) — confirm before relying on it.');
    expect(pairs(found)).toContainEqual([2, '22']);
    expect(found.every((candidate) => !candidate.text.includes('confirm before relying'))).toBe(true);
  });

  it('comes from a grounded value', () => {
    expect(pairs(one('Limit applies to POST /api/upload.', { groundedFactValues: ['POST /api/upload'] })))
      .toContainEqual([2, 'POST /api/upload']);
  });

  it('is NEVER an identifier', () => {
    const found = one('The rule comes from fact-77.', {
      groundedFactValues: ['fact-77'],
      sourceFactIds: ['fact-77'],
    });
    expect(found.some((candidate) => candidate.text === 'fact-77')).toBe(false);
  });
});

describe('classes 3 and 4 — boundaries and conditions', () => {
  it('binds a boundary to the clause it governs, not the bare word', () => {
    expect(pairs(one('Do not modify the auth middleware.'))).toContainEqual([3, 'Do not modify the auth middleware']);
  });

  it('takes the longer boundary rather than the bare word inside it', () => {
    const found = one('Do not modify the auth middleware.');
    expect(found.filter((candidate) => candidate.emphasisClass === 3)).toHaveLength(1);
  });

  it('marks a trailing limiter on its own, because nothing follows it', () => {
    expect(pairs(one('Limit applies to the upload endpoint only.'))).toContainEqual([3, 'only']);
  });

  // A bare `not` needs something to negate. `do not` and `must not` carry their own verb and are
  // matched whole, so a bare one reaches the scan only where neither did — and there it is either
  // negating a verb, or sitting inside a noun phrase that merely NAMES a practice. The second is
  // a description, and a description is not a constraint.
  //
  // Both directions are pinned, and every sentence here is written from the grammar: a detector
  // that only ever says no would pass half of this block as surely as one that only says yes.
  describe('a bare `not` is a limit only when it negates something', () => {
    for (const governed of [
      'You should not send the request twice.',
      'The migration must be reversible, and it is not reversible today.',
      'The token will not be refreshed automatically.',
      'The endpoint can not be called before the handshake.',
      'This path has not been verified on staging.',
    ]) {
      it(`marks it: ${JSON.stringify(governed)}`, () => {
        expect(one(governed).some((candidate) => candidate.emphasisClass === 3)).toBe(true);
      });
    }

    for (const named of [
      'Follow best practices like not sharing credentials in the repository.',
      'Consider strategies such as not caching the response body.',
      'The checklist covers things like not logging tokens.',
    ]) {
      it(`does not mark it: ${JSON.stringify(named)}`, () => {
        const found = one(named).filter((candidate) => candidate.emphasisClass === 3);
        expect(found, `"not …" here names a practice; it imposes no limit`).toEqual([]);
      });
    }

    it('still takes the whole limiter when the line carries one, alongside a named practice', () => {
      // The governed limiter earns its mark; the named practice in the same line does not, and the
      // two are distinguished by what precedes the word rather than by where it sits.
      const found = one('Do not log the token, and follow practices like not caching the body.');
      expect(pairs(found).filter(([klass]) => klass === 3)).toEqual([[3, 'Do not log the token']]);
    });
  });

  it('binds a condition to its clause', () => {
    // Given something to qualify — see the section below for why that is the condition of it
    // being marked at all. What this pins is the span: the clause, not the sentence around it.
    const found = one('Run the migration once the backup finishes.', { groundedFactValues: ['the migration'] });
    expect(pairs(found)).toContainEqual([4, 'once the backup finishes']);
  });
});

describe('a condition qualifies something, so it is not marked alone', () => {
  // ⚠️ Measured, not assumed. Over ten recorded popups conditions were 16 of 23 marks and 5 of
  // the 6 that landed on a line the standard rejects: a connective turns up on good lines and bad
  // alike, so a class firing on connectives by itself spends the reader's attention wherever the
  // composer happened to put one.

  it('marks nothing in a section that offers only a condition', () => {
    // ⏪ The fixture was `Run the migration once the backup finishes.` until 2026-09-28. Once an
    // instruction no longer had to name something already known, `Run the migration` became a mark
    // of its own and the section stopped offering only a condition — so the fixture, not the rule,
    // had to change. This one states nothing for the condition to qualify: no verb heads its clause.
    expect(one('The rollout happens once the backup finishes.')).toEqual([]);
  });

  it('marks it once the same section carries a limit it can qualify', () => {
    const found = one('Touch the upload path only. Run it once the backup finishes.');
    expect(pairs(found)).toContainEqual([3, 'only']);
    expect(pairs(found)).toContainEqual([4, 'once the backup finishes']);
  });

  it('marks it once the same section carries one of the developer’s own words', () => {
    const found = one('Rebuild the search index after the import completes.', { groundedFactValues: ['the search index'] });
    expect(pairs(found)).toContainEqual([2, 'the search index']);
    expect(pairs(found)).toContainEqual([4, 'after the import completes']);
  });

  it('drops the condition in the bare section and still marks it in the section that anchors it', () => {
    // The two sections carry the SAME words, so this also pins that dropping one does not make
    // the other unreachable — the dedupe has to give the key back.
    const found = classify({
      originalPromptText: 'do the work',
      sections: [
        { sectionKind: 'context_and_constraints', sectionText: 'Ship it once the backup finishes.' },
        {
          sectionKind: 'verification_or_test_plan',
          sectionText: 'Rebuild the search index once the backup finishes.',
          groundedFactValues: ['the search index'],
        },
      ],
    });
    expect(pairs(found)).toEqual([[2, 'the search index'], [4, 'once the backup finishes']]);
  });
});

describe('class 5 — the sentences the pipeline inserts', () => {
  it('marks the confirmation’s named action, and the rest of that sentence stays plain', () => {
    const found = one(CONFIRMATION, {}, { sensitiveActionName: NAMED_ACTION });
    expect(pairs(found)).toContainEqual([5, NAMED_ACTION]);
    expect(found.some((candidate) => candidate.text.includes('go-ahead confirmation'))).toBe(false);
    expect(found.some((candidate) => candidate.text.includes('ground level'))).toBe(false);
  });

  it('marks its second scope unit as a boundary, not a safety line', () => {
    const found = one(CONFIRMATION, {}, { sensitiveActionName: NAMED_ACTION });
    expect(pairs(found)).toContainEqual([3, 'Do not assume']);
    expect(found.some((candidate) => candidate.emphasisClass === 5 && candidate.text === 'Do not assume')).toBe(false);
  });

  it('marks the history-lane safeguard’s generic naming', () => {
    const safeguard = 'Still, before you do this sensitive action you must ask me for go-ahead confirmation, and before you ask, confirm the actual state at ground level by reading the real source. Do not assume, and do not rely on what you did earlier in this session.';
    expect(pairs(one(safeguard))).toContainEqual([5, 'sensitive action']);
  });

  it('marks only the stance’s second half', () => {
    const found = one(STANCE);
    expect(pairs(found)).toContainEqual([5, 'rather than carrying it out']);
    expect(found.some((candidate) => candidate.text.includes('touches something risky'))).toBe(false);
  });
});

describe('what is never marked', () => {
  it('marks nothing at all inside the developer’s own section', () => {
    expect(classify({
      originalPromptText: 'deploy the payment client',
      sections: [{
        sectionKind: 'original_request_or_goal',
        sectionText: "Do not touch auth. I'll deploy the payment client only.",
        groundedFactValues: ['the payment client', 'auth'],
      }],
    })).toEqual([]);
  });

  it('marks nothing at all inside the practices section', () => {
    expect(classify({
      originalPromptText: 'deploy the payment client',
      sections: [{
        sectionKind: 'source_signal_guidance',
        sectionText: "Do not skip the tests. I'll review the payment client only.",
        groundedFactValues: ['the payment client'],
      }],
    })).toEqual([]);
  });

  it('cuts a candidate before a secret-shaped token, in every class', () => {
    const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX';
    const found = one(`Do not paste ${secret} into the log.`);
    for (const candidate of found) expect(candidate.text).not.toContain(secret);
    // And the surviving half is still a real phrase, not an empty mark.
    expect(found.every((candidate) => candidate.text.trim().length > 0)).toBe(true);
  });
});

describe('the patterns this phase only made visible', () => {
  it('leaves the write-verb pattern byte for byte as it was', () => {
    expect(EXECUTION_VERB.source).toBe(
      '\\b(?:run|execute|deploy|delete|remove|migrate|install|force[-\\s]?push|publish|post|notify|write|modify|apply|rotate|increase|truncate|drop|karo|kar\\s+do|chalao|hatao|mitao|lagao)\\b|(?:करो|कर\\s*दो|चलाओ|हटाओ|मिटाओ|लिखो|बदलो|કરો|કરી\\s*દો|ચલાવો|કાઢી\\s*નાખો|મિટાવો|લખો|બદલો)',
    );
    expect(EXECUTION_VERB.flags).toBe('i');
  });

  it('leaves the escalation pattern byte for byte as it was', () => {
    expect(ALWAYS_ESCALATE_PATTERN.source).toBe(
      '\\b(?:force[-\\s]?push|rm\\s+-rf|drop\\s+table|truncate|reset\\s+--hard|rewrite\\s+history)\\b',
    );
    expect(ALWAYS_ESCALATE_PATTERN.flags).toBe('i');
  });
});

describe('how much of a line a mark takes', () => {
  // Emphasis works by contrast, so every rule here is about making a mark SHORTER than the line it
  // sits on. Each one is stated in both directions: the shape that is cut, and the shape beside it
  // that must survive the cut — a rule with only its cutting half tested would pass if it cut
  // everything.

  describe('a list marker is punctuation, not a word', () => {
    it('marks the instruction on a line a bullet opens', () => {
      expect(pairs(one(
        '- Check the auth middleware before wrapping up.',
        { groundedFactValues: ['auth middleware'] },
      ))).toContainEqual([1, 'Check the auth middleware']);
    });

    it('still refuses a verb that is genuinely buried in the line', () => {
      // The marker is stripped; nothing else is. A verb with words of its own in front of it is the
      // body describing work, not instructing it, and that reading has to survive the strip.
      expect(pairs(one(
        '- The reviewer will check the auth middleware before wrapping up.',
        { groundedFactValues: ['auth middleware'] },
      )).filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
    });
  });

  describe('an instruction is the verb and its object', () => {
    it('stops where the sentence turns to explaining itself', () => {
      const found = pairs(one(
        'List out the exact steps that lead to hitting this null error.',
        { groundedFactValues: ['null error'] },
      ));
      expect(found).toContainEqual([1, 'List out the exact steps']);
      // …and the sentence it was cut out of is not also a mark.
      expect(found).not.toContainEqual([1, 'List out the exact steps that lead to hitting this null error']);
    });

    it('keeps going when stopping would leave the verb with nothing to act on', () => {
      // `that` can introduce the object rather than a second thought. Stopping at it would mark
      // `Check` alone, which tells a reader nothing.
      expect(pairs(one(
        'Check that the home page still loads.',
        { groundedFactValues: ['home page'] },
      ))).toContainEqual([1, 'Check that the home page still loads']);
    });
  });

  describe('a boundary or a condition stops at eight words', () => {
    it('marks one of eight words, because it reads as a single thing', () => {
      expect(pairs(one(
        'Do not modify the shared billing rate limiter.',
        { groundedFactValues: ['billing rate limiter'] },
      ))).toContainEqual([3, 'Do not modify the shared billing rate limiter']);
    });

    it('drops the same shape once it runs to nine', () => {
      const found = pairs(one(
        'Do not modify the shared billing rate limiter configuration.',
        { groundedFactValues: ['billing rate limiter'] },
      ));
      expect(found).not.toContainEqual([3, 'Do not modify the shared billing rate limiter configuration']);
      // Named so a mutation cannot pass by shortening the phrase to something else instead.
      expect(found.filter(([emphasisClass]) => emphasisClass === 3)).toEqual([]);
    });

    it('leaves the classes that build a noun phrase alone', () => {
      // Classes 1, 2 and 5 are deliberately outside the ceiling. A nine-word instruction is still
      // an instruction, and shortening it is the rule above, not this one.
      expect(pairs(one(
        'Check the exact rollout order for the billing rate limiter.',
        { groundedFactValues: ['billing rate limiter'] },
      )).some(([emphasisClass]) => emphasisClass === 1)).toBe(true);
    });
  });

  describe('a term already inside an instruction is not marked twice — in that section', () => {
    it('drops the term where the instruction marking it stands', () => {
      const found = pairs(one(
        '- Check the home page layout, then stop.',
        { groundedFactValues: ['home page'] },
      ));
      expect(found).toContainEqual([1, 'Check the home page layout']);
      expect(found).not.toContainEqual([2, 'home page']);
    });

    it('marks it again in a later section, which is a different span', () => {
      // Two marks in two sections are not one ragged mark, and the cap counts them separately. Read
      // over the whole body instead, the later section is left with nothing at all.
      const found = pairs(classify({
        originalPromptText: 'fix the home page',
        sections: [
          {
            sectionKind: 'context_and_constraints',
            sectionText: '- Check the home page layout, then stop.',
            groundedFactValues: ['home page'],
          },
          {
            sectionKind: 'acceptance_or_output_expectation',
            sectionText: 'The home page must stay responsive.',
            groundedFactValues: ['home page'],
          },
        ],
      }));
      expect(found).toContainEqual([1, 'Check the home page layout']);
      expect(found).toContainEqual([2, 'home page']);
    });
  });
});

describe('a composed line holds several instructions', () => {
  // The composer writes a step list as ONE line: `First, design … Next, implement … Then, embed …`.
  // Read whole, the first execution verb anywhere in the line decided the whole line, so a real body
  // full of steps carried no instruction at all.

  it('finds the instruction in the second sentence, past a verb that blocked the first', () => {
    const found = pairs(one(
      '- We will deploy it later. Check the auth middleware for the null error.',
      { groundedFactValues: ['auth middleware'] },
    ));
    expect(found).toContainEqual([1, 'Check the auth middleware']);
  });

  it('still refuses the sentence whose verb does not open it', () => {
    // Splitting must not turn every verb into an instruction — `deploy` has `We will` in front of it
    // in its own sentence, and that is the body describing work, not instructing it.
    expect(pairs(one(
      '- We will deploy it later. Check the auth middleware for the null error.',
      { groundedFactValues: ['auth middleware'] },
    )).filter(([, text]) => text.toLowerCase().includes('deploy'))).toEqual([]);
  });

  it('reads a sequencing word as punctuation, not as someone doing something', () => {
    expect(pairs(one(
      '- First, review the auth middleware.',
      { groundedFactValues: ['auth middleware'] },
    ))).toContainEqual([1, 'review the auth middleware']);
  });

  it('marks the verbs a step list is written with', () => {
    expect(pairs(one(
      '- Design the layout of the cart drawer.',
      { groundedFactValues: ['cart drawer'] },
    ))).toContainEqual([1, 'Design the layout of the cart drawer']);
  });

  it('leaves a single-sentence line exactly as it was', () => {
    // The split only applies where there is something to split; one sentence must take the same path
    // it always did, or every earlier rule in this file is being re-decided by accident.
    expect(pairs(one(
      '- Check the auth middleware before wrapping up.',
      { groundedFactValues: ['auth middleware'] },
    ))).toContainEqual([1, 'Check the auth middleware']);
  });
});

describe('which verb a clause is about', () => {
  it('takes the verb that comes first, not the one from the more dangerous list', () => {
    // `Embed` opens the clause and is a read; `delete` stands further in and is a write. Choosing by
    // list rather than by position took `delete`, found words in front of it, and threw the whole
    // instruction away.
    expect(pairs(one(
      '- Embed the auth middleware, then delete the old ones.',
      { groundedFactValues: ['auth middleware'] },
    ))).toContainEqual([1, 'Embed the auth middleware']);
  });

  it('still records a write as a write, which is what the cap ranks on', () => {
    const found = classify({
      originalPromptText: 'do the work',
      sections: [{
        sectionKind: 'context_and_constraints',
        sectionText: '- Delete the auth middleware cache.',
        groundedFactValues: ['auth middleware'],
      }],
    });
    const action = found.find((candidate) => candidate.emphasisClass === 1);
    expect(action?.text).toBe('Delete the auth middleware cache');
    expect(action?.isWriteVerb).toBe(true);
  });
});

describe('an instruction no longer has to name something already known', () => {
  it('marks an instruction whose object the corpus has never heard of', () => {
    // ⏪ This was refused until 2026-09-28 — "a verb with an object nobody named is the body inventing
    // work". Measured over the recorded bodies, that rule found 47 instructions and threw them away,
    // leaving seven standing in the whole corpus.
    expect(pairs(one('- Identify the dependencies between the queue workers.'))).toContainEqual(
      [1, 'Identify the dependencies between the queue workers'],
    );
  });

  it('still refuses a verb with nothing to act on', () => {
    // The rule that went is about WHOSE words the object is, not about whether there is one.
    expect(pairs(one('- Check.')).filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
  });
});

describe('an instruction is a phrase, not a sentence', () => {
  it('drops one that runs past the line', () => {
    const found = pairs(one(
      '- Verify if there are any specific libraries or frameworks we should use or avoid.',
    ));
    expect(found.filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
  });

  it('keeps one of exactly eight words, and drops the same shape at nine', () => {
    expect(pairs(one('- Check the auth middleware cache inside queue workers.')))
      .toContainEqual([1, 'Check the auth middleware cache inside queue workers']);
    expect(pairs(one('- Check the auth middleware cache inside the queue workers.'))
      .filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
  });

  it('stops where the sentence turns to the circumstances of the work', () => {
    // `where`, `based` and `among` each turn an instruction into its own explanation.
    expect(pairs(one('- Run user testing sessions where participants interact with the button.')))
      .toContainEqual([1, 'Run user testing sessions']);
  });
});

describe('a mark does not end mid-thought', () => {
  it('drops a hanging auxiliary left behind by the shortening', () => {
    // `Verify the filtering functionality is based on the restaurant's name` stops at `based`, which
    // used to leave `…functionality is` — a sentence someone cut, not a phrase.
    expect(pairs(one(
      "- Verify the filtering functionality is based on the restaurant's name.",
      { groundedFactValues: ['filtering functionality'] },
    ))).toContainEqual([1, 'Verify the filtering functionality']);
  });

  it('drops a hanging conjunction', () => {
    const found = pairs(one('- Note what options are present before and after pressing that button.'));
    expect(found.filter(([emphasisClass]) => emphasisClass === 4).map(([, text]) => text))
      .not.toContain('before and');
  });

  it('leaves a phrase that legitimately ends on a pronoun', () => {
    // ⛔ `Without this` is complete. Trimming pronouns would turn it into `Without`, which is worse
    // than the thing being fixed — so pronouns are deliberately not trimmed.
    expect(pairs(one('- Without this, the import cannot be traced.')))
      .toContainEqual([3, 'Without this']);
  });
});

describe('the composer’s own scaffolding earns no instruction mark', () => {
  // ⛔ The owner's rule: "aeva je nexpath contain add karu hoy aeva contain bold karva na" — what the
  // body adds about ITSELF is not what the reader came to check. `cover` was in the verb list until
  // 2026-09-28 and every mark it ever produced was this one template sentence.
  const TEMPLATE = 'Cover Scope and non-goals for this request with concrete, source-backed specifics — state what is in and what is deliberately out.';

  it('marks no instruction in the template sentence', () => {
    expect(pairs(one(`- ${TEMPLATE}`)).filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
  });

  it('still marks a real instruction in the same section', () => {
    // The guard is about that sentence, not about the section it sits in — a section carrying both
    // must still show the developer's own work.
    expect(pairs(one(`- ${TEMPLATE}\n- Identify the source of the requirements.`)))
      .toContainEqual([1, 'Identify the source of the requirements']);
  });
});

describe('the verbs a plan is written with', () => {
  it('marks the instruction a planning line gives', () => {
    expect(pairs(one('- Develop the initial mockups for the checkout page.')))
      .toContainEqual([1, 'Develop the initial mockups']);
  });

  it('marks one written as two words', () => {
    expect(pairs(one('- Set up checks that target the payment gateway client.')))
      .toContainEqual([1, 'Set up checks']);
  });

  it('still refuses the composer’s own template line for the risk section', () => {
    // ⛔ `name` opens this and is deliberately in no verb list: every mark it produced was this one
    // sentence, in body after body — the same shape as `cover`, and the same reason.
    expect(pairs(one('- Name risky or irreversible actions, ask for required confirmation, and include rollback steps.'))
      .filter(([emphasisClass]) => emphasisClass === 1)).toEqual([]);
  });
});
