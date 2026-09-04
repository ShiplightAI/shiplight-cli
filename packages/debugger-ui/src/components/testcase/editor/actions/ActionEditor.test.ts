import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { NextIntlClientProvider } from 'next-intl';

import { ThemeProvider } from '@/contexts/ThemeContext';
import { EditorProvider } from '../contexts/EditorContext';
import { ActionEditor } from './ActionEditor';

describe('ActionEditor', () => {
  it('shows both the description and JavaScript for a code step', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        NextIntlClientProvider,
        {
          locale: 'en',
          timeZone: 'UTC',
          messages: {
            TestCases: {
              actionEditor: {
                enterAction: 'Enter an action',
                clickToAdd: 'Click to add',
              },
              codeEditor: {
                clickToOpen: 'Click to edit',
              },
            },
          },
        },
        React.createElement(
          MantineProvider,
          null,
          React.createElement(
            ThemeProvider,
            { defaultTheme: 'light' },
            React.createElement(
              EditorProvider,
              { enabled: true, statements: [] },
              React.createElement(ActionEditor, {
                actionName: 'js_code',
                description: 'Seed the authenticated session',
                hasActionEntity: true,
                actionEntity: {
                  action_description: 'Seed the authenticated session',
                  action_data: {
                    action_name: 'js_code',
                    kwargs: {
                      code: "await page.evaluate(() => localStorage.setItem('token', 'test'))",
                    },
                  },
                },
                onDescriptionChange: () => {},
                onCodeConfirm: () => {},
                enabled: true,
              }),
            ),
          ),
        ),
      ),
    );

    assert.match(html, /Seed the authenticated session/);
    assert.match(html, /await page\.evaluate/);
  });
});
