-- geo_level_enum includes 'national' in addition to BUILD_PLAN.md §4.1's literal
-- ENUM(region|province|citymun|barangay): §6 increment 0.5 requires a national sentinel
-- row (geo_code = 'PH') in dim_geo, which needs a matching geo_level value. See docs/DECISIONS.md.
create type geo_level_enum as enum ('national', 'region', 'province', 'citymun', 'barangay');

create type payer_level_enum as enum ('region', 'province', 'citymun', 'barangay');

create type honorarium_frequency_enum as enum ('monthly', 'quarterly', 'semi_annual', 'annual', 'other');

create type demographic_dimension_enum as enum ('sex', 'age_band', 'civil_status', 'bloodtype', 'education', 'ip_status');

create type feedback_category_enum as enum ('bug', 'data_question', 'suggestion', 'other');

create type quota_window_enum as enum ('minute', 'day', 'month');

create type admin_role_enum as enum ('admin', 'editor');
