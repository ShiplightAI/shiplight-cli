goal: Verify the basic form can be completed and submitted successfully
base_url: https://static.shiplight.ai/
statements:
  - URL: /testing/forms/basic-form.html

  - intent: Type 'Jane Doe' into the Full Name field
    action: input_text
    locator: "getByRole('textbox', { name: 'Full Name *' })"
    text: Jane Doe

  - intent: Type 'jane.doe@example.com' into the Email Address field
    action: input_text
    locator: "getByRole('textbox', { name: 'Email Address *' })"
    text: jane.doe@example.com

  - intent: Set the Birth Date to '1995-05-15'
    action: set_date_for_native_date_picker
    locator: "getByRole('textbox', { name: 'Birth Date *' })"
    date: 1995-05-15

  - intent: Click the 'Choose a country' button
    action: click
    locator: "getByRole('button', { name: 'Choose a country' })"

  - intent: Click on Argentina in the country dropdown list
    action: click
    locator: getByText('🇦🇷 Argentina')

  - intent: Type a mock message into the Message field
    action: input_text
    locator: "getByRole('textbox', { name: 'Message' })"
    text: This is a mock message for testing purposes.

  - intent: Check the 'I agree to the Terms and Conditions' checkbox
    action: click
    locator: "getByRole('checkbox', { name: 'I agree to the Terms and' })"

  - intent: Click the 'Submit Form' button
    action: click
    locator: "getByRole('button', { name: 'Submit Form' })"

  - VERIFY: A success message is displayed
