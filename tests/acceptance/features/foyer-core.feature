Feature: Foyer core
  As a Foyer user
  I want to sign in and see my home screen
  So that I land in a known, personalised place

  @manualLogin @R.1
  Scenario: Sign in with valid credentials
    Given I am on the sign-in screen
    When I sign in with valid credentials
    Then I am on the home page

  @manualLogin @R.2
  Scenario: Invalid credentials are rejected
    Given I am on the sign-in screen
    When I sign in with invalid credentials
    Then I see a sign-in error
    And I am still on the sign-in screen

  @adminLogin @R.3
  Scenario: Sign out returns to the sign-in screen
    Given I am on the home page
    When I sign out
    Then I am on the sign-in screen

  @adminLogin @R.4
  Scenario: Home page shows the default welcome banner
    Given I am on the home page
    Then the welcome banner shows the default message

  @adminLogin @R.5
  Scenario: Home page greets the signed-in person
    Given I am on the home page
    Then the home page greets me by my email name
