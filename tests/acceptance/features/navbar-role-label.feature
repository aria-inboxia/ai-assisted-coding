Feature: Navbar role label
  As a signed-in person
  I want to see my role displayed in the navigation bar
  So that I know which access level I am signed in with

  @adminLogin @R.1
  Scenario: Admin role label is shown in the navbar
    Given I am on the home page
    Then the navbar shows the admin role label

  @userLogin @R.2
  Scenario: Regular user role label is shown in the navbar
    Given I am on the home page
    Then the navbar shows the user role label
