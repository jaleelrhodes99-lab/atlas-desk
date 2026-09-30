terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 5.0"
    }
  }
}

provider "github" {
  # Set GITHUB_TOKEN in your environment
  owner = "jaleelrhodes99-lab"
}

resource "github_branch_protection" "main" {
  repository = "atlas-desk"
  pattern    = "main"

  enforce_admins = true

  required_status_checks {
    strict   = true
    contexts = ["ForexBUILD1"]
  }

  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    required_approving_review_count = 1
    require_code_owner_reviews      = false
  }

  required_linear_history {
    enabled = true
  }

  allow_force_pushes {
    enabled = false
  }

  allow_deletions {
    enabled = false
  }
}
