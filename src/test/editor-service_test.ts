/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import * as chai from 'chai';
import {assert} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {FSUrlLoader, PackageUrlResolver, UrlLoader} from 'polymer-analyzer';
import {CodeUnderliner} from 'polymer-analyzer/lib/test/test-utils';

import {AttributesCompletion, ElementCompletion, LocalEditorService} from '../local-editor-service';

chai.use(require('chai-subset'));

function singleFileLoader(
    path: string, contentsGetter: () => string): UrlLoader {
  return {
    canLoad() {
      return true;
    },
    async load(reqPath: string) {
      if (reqPath === path) {
        return contentsGetter();
      }
      throw new Error(`Unknown file: ${reqPath}`);
    }
  };
}

suite('editorService', () => {
  const basedir = path.join(__dirname, 'static');
  const indexFile = path.join('editor-service', 'index.html');

  const tagPosition = {line: 7, column: 9};
  const tagPositionEnd = {line: 7, column: 21};
  const localAttributePosition = {line: 7, column: 31};

  const elementTypeahead: ElementCompletion = {
    kind: 'element-tags',
    elements: [
      {
        tagname: 'behavior-test-elem',
        description: 'An element to test out behavior inheritance.',
        expandTo: '<behavior-test-elem ></behavior-test-elem>',
        expandToSnippet: '<behavior-test-elem $1></behavior-test-elem>$0'
      },
      {
        description: '',
        tagname: 'class-declaration',
        expandTo: '<class-declaration></class-declaration>',
        expandToSnippet: '<class-declaration></class-declaration>$0'
      },
      {
        description: '',
        tagname: 'anonymous-class',
        expandTo: '<anonymous-class></anonymous-class>',
        expandToSnippet: '<anonymous-class></anonymous-class>$0'
      },
      {
        description: '',
        tagname: 'class-expression',
        expandTo: '<class-expression></class-expression>',
        expandToSnippet: '<class-expression></class-expression>$0'
      },
      {
        description: '',
        tagname: 'register-before-declaration',
        expandTo: '<register-before-declaration></register-before-declaration>',
        expandToSnippet:
            '<register-before-declaration></register-before-declaration>$0'
      },
      {
        description: '',
        tagname: 'register-before-expression',
        expandTo: '<register-before-expression></register-before-expression>',
        expandToSnippet:
            '<register-before-expression></register-before-expression>$0'
      },
      {
        description: 'This is a description of WithObservedAttributes.',
        tagname: 'vanilla-with-observed-attributes',
        expandTo:
            '<vanilla-with-observed-attributes ></vanilla-with-observed-attributes>',
        expandToSnippet:
            '<vanilla-with-observed-attributes $1></vanilla-with-observed-attributes>$0'
      },
    ]
  };
  // Like elementTypeahead, but we also want to add a leading < because we're
  // in a context where we don't have one.
  const emptyStartElementTypeahead = Object.assign({}, elementTypeahead);
  emptyStartElementTypeahead.elements =
      emptyStartElementTypeahead.elements.map(e => {
        let copy = Object.assign({}, e);
        let space = '';
        const elementsWithAttributes =
            new Set(['vanilla-with-observed-attributes', 'behavior-test-elem']);
        if (elementsWithAttributes.has(e.tagname)) {
          space = ' ';
        }
        copy.expandTo = `<${e.tagname}${space}></${e.tagname}>`;
        copy.expandToSnippet = `<${e.tagname}${space ? space + '$1' : ''
        }></${e.tagname}>$0`;
        return copy;
      });

  const attributeTypeahead: AttributesCompletion = {
    kind: 'attributes',
    attributes: [
      {
        name: 'local-property',
        description: 'A property defined directly on behavior-test-elem.',
        type: 'boolean',
        sortKey: 'aaa-local-property',
        inheritedFrom: undefined,
      },
      {
        name: 'non-notifying-property',
        description: '',
        type: 'string',
        sortKey: 'aaa-non-notifying-property',
        inheritedFrom: undefined,
      },
      {
        name: 'notifying-property',
        description: '',
        type: 'string',
        sortKey: 'aaa-notifying-property',
        inheritedFrom: undefined,
      },
      {
        name: 'deeply-inherited-property',
        description: 'This is a deeply inherited property.',
        type: 'Array',
        sortKey: 'ddd-deeply-inherited-property',
        inheritedFrom: 'MyNamespace.SubBehavior',
      },
      {
        name: 'inherit-please',
        description: 'A property provided by SimpleBehavior.',
        type: 'number',
        sortKey: 'ddd-inherit-please',
        inheritedFrom: 'MyNamespace.SimpleBehavior',
      },
      {
        name: 'on-local-property-changed',
        description: 'Fired when the `localProperty` property changes.',
        type: 'CustomEvent',
        sortKey: 'eee-aaa-on-local-property-changed',
        inheritedFrom: undefined,
      },
      {
        name: 'on-notifying-property-changed',
        description: 'Fired when the `notifyingProperty` property changes.',
        type: 'CustomEvent',
        sortKey: 'eee-aaa-on-notifying-property-changed',
        inheritedFrom: undefined,
      },
      {
        name: 'on-deeply-inherited-property-changed',
        description:
            'Fired when the `deeplyInheritedProperty` property changes.',
        type: 'CustomEvent',
        sortKey: 'eee-ddd-on-deeply-inherited-property-changed',
        inheritedFrom: 'MyNamespace.SubBehavior',
      },
      {
        name: 'on-inherit-please-changed',
        description: 'Fired when the `inheritPlease` property changes.',
        type: 'CustomEvent',
        sortKey: 'eee-ddd-on-inherit-please-changed',
        inheritedFrom: 'MyNamespace.SimpleBehavior',
      },
    ]
  };
  const indexContents = fs.readFileSync(path.join(basedir, indexFile), 'utf-8');

  let editorService: LocalEditorService;
  setup(async() => {
    editorService = new LocalEditorService({
      urlLoader: new FSUrlLoader(basedir),
      urlResolver: new PackageUrlResolver()
    });
  });

  suite('getReferencesForFeatureAtPosition', function() {

    const contentsPath = path.join('editor-service', 'references.html');
    const contents = fs.readFileSync(path.join(basedir, contentsPath), 'utf-8');
    const underliner =
        new CodeUnderliner(singleFileLoader(contentsPath, () => contents));

    let testName =
        `it supports getting the references to an element from its tag`;
    test(testName, async() => {
      await editorService.fileChanged(contentsPath, `${contents}`);

      let references = (await editorService.getReferencesForFeatureAtPosition(
          contentsPath, {line: 7, column: 3}))!;
      let ranges = await underliner.underline([...references]);
      assert.deepEqual(ranges, [
        `
  <anonymous-class one></anonymous-class>
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`,
        `
  <anonymous-class two></anonymous-class>
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`
      ]);

      references = (await editorService.getReferencesForFeatureAtPosition(
          contentsPath, {line: 8, column: 3}))!;
      ranges = await underliner.underline([...references]);

      assert.deepEqual(ranges, [
        `
  <simple-element one></simple-element>
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`,
        `
    <simple-element two></simple-element>
    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~`
      ]);
    });
  });

  suite('getTypeaheadCompletionsAtPosition', function() {

    test('Get element completions for an empty text region.', async() => {
      await editorService.fileChanged(indexFile, `\n${indexContents}`);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, {line: 0, column: 0}),
          emptyStartElementTypeahead);
    });

    test('Get element completions for a start tag.', async() => {
      await editorService.fileChanged(indexFile, indexContents);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, tagPosition),
          elementTypeahead);
    });

    test('Gets element completions with an incomplete tag', async() => {
      await editorService.fileChanged(indexFile, indexContents);
      const incompleteText = `<behav>`;
      editorService.fileChanged(
          indexFile, `${incompleteText}\n${indexContents}`);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, {line: 0, column: incompleteText.length - 2}),
          elementTypeahead);
    });

    test('Get element completions for the end of a tag', async() => {
      await editorService.fileChanged(indexFile, indexContents);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, tagPositionEnd),
          elementTypeahead);
    });

    let testName =
        'Get attribute completions when editing an existing attribute';
    test(testName, async() => {
      await editorService.fileChanged(indexFile, indexContents);
      assert.deepEqual(
          (await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, localAttributePosition)),
          attributeTypeahead);
    });

    test('Get attribute completions when adding a new attribute', async() => {
      await editorService.fileChanged(indexFile, indexContents);
      const partialContents = [
        `<behavior-test-elem >`, `<behavior-test-elem existing-attr>`,
        `<behavior-test-elem existing-attr></behavior-test-elem>`,
        `<behavior-test-elem existing-attr></wrong-closing-tag>`
      ];
      for (const partial of partialContents) {
        await editorService.fileChanged(
            indexFile, `${partial}\n${indexContents}`);
        assert.deepEqual(
            await editorService.getTypeaheadCompletionsAtPosition(indexFile, {
              line: 0,
              column: 20 /* after the space after the element name */
            }),
            attributeTypeahead);
      }
    });

    testName = 'Get attribute value completions for non-notifying property';
    test(testName, async() => {
      const testFile = path.join('editor-service', 'value-completion.html');
      const testContents =
          fs.readFileSync(path.join(basedir, testFile), 'utf-8');
      await editorService.fileChanged(testFile, testContents);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(testFile, {
            line: 4,
            column: 49 /* after the space after the element name */
          }),
          {
            'attributes': [
              {
                'autocompletion': '[[bar]]',
                'description': '',
                'name': 'bar',
                'sortKey': 'aaa-bar',
                'type': 'string',
                'inheritedFrom': undefined
              },
              {
                'autocompletion': '[[foo]]',
                'description': '',
                'name': 'foo',
                'sortKey': 'aaa-foo',
                'type': 'string',
                'inheritedFrom': undefined
              },
            ],
            'kind': 'attribute-values'
          });
    });

    test('Get attribute value completions for notifying property', async() => {
      const testFile = path.join('editor-service', 'value-completion.html');
      const testContents =
          fs.readFileSync(path.join(basedir, testFile), 'utf-8');
      await editorService.fileChanged(testFile, testContents);
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(testFile, {
            line: 4,
            column: 71 /* after the space after the element name */
          }),
          {
            'attributes': [
              {
                'autocompletion': '{{bar}}',
                'description': '',
                'name': 'bar',
                'sortKey': 'aaa-bar',
                'type': 'string',
                'inheritedFrom': undefined
              },
              {
                'autocompletion': '{{foo}}',
                'description': '',
                'name': 'foo',
                'sortKey': 'aaa-foo',
                'type': 'string',
                'inheritedFrom': undefined
              },
            ],
            'kind': 'attribute-values'
          });
    });

    test(
        'Get attribute value completions for notifying property without brackets',
        async() => {
          const testFile = path.join('editor-service', 'value-completion.html');
          const testContents =
              fs.readFileSync(path.join(basedir, testFile), 'utf-8');
          await editorService.fileChanged(testFile, testContents);
          assert.deepEqual(
              await editorService.getTypeaheadCompletionsAtPosition(testFile, {
                line: 4,
                column: 91 /* after the space after the element name */
              }),
              {
                'attributes': [
                  {
                    'autocompletion': 'bar',
                    'description': '',
                    'name': 'bar',
                    'sortKey': 'aaa-bar',
                    'type': 'string',
                    'inheritedFrom': undefined
                  },
                  {
                    'autocompletion': 'foo',
                    'description': '',
                    'name': 'foo',
                    'sortKey': 'aaa-foo',
                    'type': 'string',
                    'inheritedFrom': undefined
                  },
                ],
                'kind': 'attribute-values'
              });
        });

    test('Inserts slots in autocompletion snippet', async() => {
      const slotFile = path.join('editor-service', 'slot.html');
      await editorService.fileChanged(
          slotFile, fs.readFileSync(path.join(basedir, slotFile), 'utf-8'));

      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(slotFile, {
            line: 1,
            column: 0 /* after the space after the element name */
          }),
          {
            'elements': [
              {
                'description': '',
                'expandTo': '<slot-test-elem></slot-test-elem>',
                'expandToSnippet': `<slot-test-elem>
\t<$\{1:div\} slot="slot1">$2</$\{1:div\}>
\t<$\{3:div\} slot="slot2">$4</$\{3:div\}>
\t<$\{5:div\}>$6</$\{5:div\}>
</slot-test-elem>$0`,
                'tagname': 'slot-test-elem'
              },
              {
                'description': '',
                'expandTo': '<slot-one-test-elem></slot-one-test-elem>',
                'expandToSnippet':
                    `<slot-one-test-elem>$1</slot-one-test-elem>$0`,
                'tagname': 'slot-one-test-elem'
              }
            ],
            'kind': 'element-tags'
          });
    });

    test('Recover from references to undefined files.', async() => {
      await editorService.fileChanged(indexFile, indexContents);

      // Load a file that contains a reference error.
      await editorService.fileChanged(indexFile, `${indexContents}
           <script src="nonexistant.js"></script>`);

      // We recover after getting a good version of the file.
      await editorService.fileChanged(indexFile, indexContents);

      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, localAttributePosition),
          attributeTypeahead);
    });

    test('Remain useful in the face of unloadable files.', async() => {
      await editorService.fileChanged(indexFile, indexContents);

      // We load a file that contains a reference error.
      await editorService.fileChanged(indexFile, `${indexContents}
           <script src="nonexistant.js"></script>`);

      // Harder: can we give typeahead completion when there's errors?'
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, localAttributePosition),
          attributeTypeahead);
    });

    test('Remain useful in the face of syntax errors.', async() => {
      const goodContents =
          fs.readFileSync(path.join(basedir, indexFile), 'utf-8');
      // Load a file with a syntax error
      await editorService.fileChanged(
          path.join(basedir, 'syntax-error.js'),
          'var var var var var var var var “hello”');

      await editorService.fileChanged(indexFile, `${goodContents}
          <script src="./syntax-error.js"></script>`);
      // Even with a reference to the bad file we can still get completions!
      assert.deepEqual(
          await editorService.getTypeaheadCompletionsAtPosition(
              indexFile, localAttributePosition),
          attributeTypeahead);
    });

    test(`Don't give HTML completions inside of script tags.`, async() => {
      await editorService.fileChanged(
          indexFile, '<script>\n\n</script>\n' + indexContents);
      const completions = await editorService.getTypeaheadCompletionsAtPosition(
          indexFile, {line: 1, column: 0});
      assert.deepEqual(completions, undefined);
    });

  });

  {
    const fooPropUsePosition = {line: 2, column: 16};
    const internalPropUsePosition = {line: 3, column: 12};

    const databindingCompletions = {
      kind: 'properties-in-polymer-databinding' as
            'properties-in-polymer-databinding',
      properties: [
        {
          description: 'A private internal prop.',
          name: '_internal',
          sortKey: 'aaa-_internal',
          type: 'string',
          inheritedFrom: undefined,
        },
        {
          description: 'This is the foo property.',
          name: 'foo',
          sortKey: 'aaa-foo',
          type: 'string',
          inheritedFrom: undefined,
        },
      ]
    };
    test('Give autocompletions for positions in databindings.', async() => {
      let completions = await editorService.getTypeaheadCompletionsAtPosition(
          'polymer/element-with-databinding.html', fooPropUsePosition);
      assert.deepEqual(completions, databindingCompletions);

      completions = await editorService.getTypeaheadCompletionsAtPosition(
          'polymer/element-with-databinding.html', internalPropUsePosition);
      assert.deepEqual(completions, databindingCompletions);
    });

    {
      const fooPropUsePosition = {line: 2, column: 16};
      const internalPropUsePosition = {line: 3, column: 12};

      const databindingCompletions = {
        kind: 'properties-in-polymer-databinding' as
              'properties-in-polymer-databinding',
        properties: [
          {
            description: 'A private internal prop.',
            name: '_internal',
            sortKey: 'aaa-_internal',
            type: 'string',
            inheritedFrom: undefined,
          },
          {
            description: 'This is the foo property.',
            name: 'foo',
            sortKey: 'aaa-foo',
            type: 'string',
            inheritedFrom: undefined,
          },
        ]
      };
      test('Give autocompletions for positions in databindings.', async() => {
        let completions = await editorService.getTypeaheadCompletionsAtPosition(
            'polymer/element-with-databinding.html', fooPropUsePosition);
        assert.deepEqual(completions, databindingCompletions);

        completions = await editorService.getTypeaheadCompletionsAtPosition(
            'polymer/element-with-databinding.html', internalPropUsePosition);
        assert.deepEqual(completions, databindingCompletions);
      });
    }
  }
});
